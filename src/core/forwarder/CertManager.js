/**
 * CertManager - Self-signed Certificate Manager for HTTPS Interception
 *
 * Purpose:
 * - Generate and manage a self-signed CA (Certificate Authority)
 * - Dynamically generate host certificates signed by the CA
 * - Cache certificates to avoid regeneration
 * - Support HTTPS MITM (Man-in-the-Middle) proxy
 *
 * Features:
 * - Auto-generates CA certificate on first run
 * - Caches host certificates in memory
 * - Persists CA to disk for reuse across restarts
 * - Thread-safe certificate generation
 *
 * Usage:
 * const certManager = CertManager.getInstance();
 * const { key, cert } = await certManager.getCertificateForHost('example.com');
 */

const forge = require("node-forge");
const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");

class CertManager {
  static instance = null;

  constructor() {
    // Directory to store CA files
    this.certsDir = path.join(__dirname, "../../../data/certs");

    // CA certificate and key
    this.caCert = null;
    this.caKey = null;

    // Cache for host certificates { hostname: { key, cert, expires } }
    this.hostCertCache = new Map();

    // Certificate validity in days
    this.certValidityDays = 365;

    // CA validity in years
    this.caValidityYears = 10;

    // Pending certificate generation promises to avoid duplicate work
    this.pendingCerts = new Map();

    // Initialize flag
    this.initialized = false;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!CertManager.instance) {
      CertManager.instance = new CertManager();
    }
    return CertManager.instance;
  }

  /**
   * Initialize the certificate manager
   * Loads or generates CA certificate
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure certs directory exists
      if (!fs.existsSync(this.certsDir)) {
        fs.mkdirSync(this.certsDir, { recursive: true });
        logger.info("[CertManager] Created certificates directory", { path: this.certsDir });
      }

      const caKeyPath = path.join(this.certsDir, "ca.key.pem");
      const caCertPath = path.join(this.certsDir, "ca.cert.pem");

      // Check if CA already exists
      if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
        // Load existing CA
        const caKeyPem = fs.readFileSync(caKeyPath, "utf8");
        const caCertPem = fs.readFileSync(caCertPath, "utf8");

        this.caKey = forge.pki.privateKeyFromPem(caKeyPem);
        this.caCert = forge.pki.certificateFromPem(caCertPem);

        logger.info("[CertManager] Loaded existing CA certificate", {
          subject: this.caCert.subject.getField("CN")?.value,
          validUntil: this.caCert.validity.notAfter.toISOString(),
        });
      } else {
        // Generate new CA
        await this._generateCA();

        // Save CA to disk
        const caKeyPem = forge.pki.privateKeyToPem(this.caKey);
        const caCertPem = forge.pki.certificateToPem(this.caCert);

        fs.writeFileSync(caKeyPath, caKeyPem, "utf8");
        fs.writeFileSync(caCertPath, caCertPem, "utf8");

        logger.info("[CertManager] Generated and saved new CA certificate", {
          path: this.certsDir,
        });
      }

      this.initialized = true;
    } catch (error) {
      logger.error("[CertManager] Failed to initialize", { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Generate CA certificate and key
   */
  async _generateCA() {
    logger.info("[CertManager] Generating new CA certificate...");

    // Generate 2048-bit key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);
    this.caKey = keys.privateKey;

    // Create CA certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this._generateSerialNumber();

    // Validity period
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + this.caValidityYears);

    // CA attributes
    const attrs = [
      { shortName: "CN", value: "dProxy CA" },
      { shortName: "O", value: "dProxy" },
      { shortName: "OU", value: "Development" },
      { shortName: "C", value: "CA" },
      { shortName: "ST", value: "Ontario" },
      { shortName: "L", value: "Toronto" },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs); // Self-signed

    // CA extensions
    // For self-signed CA, authorityKeyIdentifier is optional
    // Android should accept CA certs without it
    cert.setExtensions([
      {
        name: "basicConstraints",
        cA: true,
        critical: true,
      },
      {
        name: "keyUsage",
        keyCertSign: true,
        cRLSign: true,
        critical: true,
      },
      {
        name: "subjectKeyIdentifier",
      },
    ]);

    // Self-sign the certificate
    cert.sign(this.caKey, forge.md.sha256.create());

    this.caCert = cert;
    logger.info("[CertManager] CA certificate generated successfully");
  }

  /**
   * Get or generate certificate for a host
   * @param {string} hostname - Target hostname
   * @returns {Promise<{key: string, cert: string}>} PEM-encoded key and certificate chain
   */
  async getCertificateForHost(hostname) {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache first
    const cached = this.hostCertCache.get(hostname);
    if (cached && cached.expires > Date.now()) {
      logger.debug("[CertManager] Using cached certificate", { hostname });
      return { key: cached.key, cert: cached.cert };
    }

    // Check if we're already generating this certificate
    if (this.pendingCerts.has(hostname)) {
      logger.debug("[CertManager] Waiting for pending certificate generation", { hostname });
      return this.pendingCerts.get(hostname);
    }

    // Generate new certificate
    const promise = this._generateHostCertificate(hostname);
    this.pendingCerts.set(hostname, promise);

    try {
      const result = await promise;

      // Cache the certificate
      const expiresAt = Date.now() + this.certValidityDays * 24 * 60 * 60 * 1000 - 86400000; // 1 day before expiry
      this.hostCertCache.set(hostname, {
        key: result.key,
        cert: result.cert,
        expires: expiresAt,
      });

      return result;
    } finally {
      this.pendingCerts.delete(hostname);
    }
  }

  /**
   * Generate certificate for a specific host
   * @param {string} hostname - Target hostname
   * @returns {Promise<{key: string, cert: string}>} PEM-encoded key and certificate
   */
  async _generateHostCertificate(hostname) {
    logger.debug("[CertManager] Generating certificate for host", { hostname });

    // Generate 2048-bit key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);

    // Create certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this._generateSerialNumber();

    // Validity period
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + this.certValidityDays);

    // Subject attributes
    const attrs = [
      { shortName: "CN", value: hostname },
      { shortName: "O", value: "dProxy" },
      { shortName: "OU", value: "Development" },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(this.caCert.subject.attributes); // Signed by CA

    // Extensions for host certificate
    const altNames = [{ type: 2, value: hostname }]; // DNS name

    // Check if hostname is an IP address
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      altNames.push({ type: 7, ip: hostname }); // IP address
    }

    // Add wildcard for subdomains
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      altNames.push({ type: 2, value: "*." + parts.slice(-2).join(".") });
    }

    // Get CA's subjectKeyIdentifier for use in authorityKeyIdentifier
    // node-forge's keyid:true doesn't work correctly, so we need to extract it manually
    const caSkiExt = this.caCert.getExtension("subjectKeyIdentifier");
    const caKeyIdBytes = caSkiExt ? forge.util.hexToBytes(caSkiExt.subjectKeyIdentifier) : null;

    // Set extensions for the host certificate
    // Android requires proper authorityKeyIdentifier that matches CA's subjectKeyIdentifier
    const extensions = [
      {
        name: "basicConstraints",
        cA: false,
      },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: "extKeyUsage",
        serverAuth: true,
      },
      {
        name: "subjectAltName",
        altNames: altNames,
      },
      {
        name: "subjectKeyIdentifier",
      },
    ];

    // Add authorityKeyIdentifier only if CA has subjectKeyIdentifier
    if (caKeyIdBytes) {
      extensions.push({
        name: "authorityKeyIdentifier",
        keyIdentifier: caKeyIdBytes,
      });
    }

    cert.setExtensions(extensions);

    // Sign with CA key
    cert.sign(this.caKey, forge.md.sha256.create());

    // Convert to PEM
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);
    const caCertPem = forge.pki.certificateToPem(this.caCert);

    // Return key and certificate chain (host cert + CA cert)
    return {
      key: keyPem,
      cert: certPem + caCertPem,
    };
  }

  /**
   * Generate a unique serial number
   */
  _generateSerialNumber() {
    // Generate a 16-byte random hex string
    const bytes = forge.random.getBytesSync(16);
    return forge.util.bytesToHex(bytes);
  }

  /**
   * Get CA certificate in PEM format
   * (For clients to install in their trust store)
   */
  async getCACertificatePEM() {
    if (!this.initialized) {
      await this.initialize();
    }
    return forge.pki.certificateToPem(this.caCert);
  }

  /**
   * Get path to CA certificate file
   */
  getCACertificatePath() {
    return path.join(this.certsDir, "ca.cert.pem");
  }

  /**
   * Clear certificate cache
   */
  clearCache() {
    this.hostCertCache.clear();
    logger.info("[CertManager] Certificate cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cachedHosts: this.hostCertCache.size,
      pendingGenerations: this.pendingCerts.size,
    };
  }
}

module.exports = CertManager;
