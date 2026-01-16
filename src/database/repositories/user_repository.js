/**
 * User Repository
 *
 * Handles all user-related database operations including CRUD operations.
 *
 * @module repositories/user_repository
 */

const dbConnection = require("../connection");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

/**
 * Create a new user
 *
 * @param {string} userIdentifier - Phone number or username for login
 * @param {string} partyId - Internal party ID
 * @param {string} clientId - Member ID (e.g., REGRES001)
 * @param {string} email - User email
 * @param {string} firstName - User first name
 * @param {string} lastName - User last name
 * @returns {Object} Created user object
 * @throws {Error} If creation fails
 */
function createUser(userIdentifier, partyId = null, clientId = null, email = null, firstName = null, lastName = null) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    const stmt = db.prepare(`
      INSERT INTO users (
        user_id,
        party_id,
        client_id,
        email,
        first_name,
        last_name,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userIdentifier, partyId, clientId, email, firstName, lastName, now, now);

    logger.info(`User created: ${userIdentifier} (ID: ${result.lastInsertRowid})`);

    return getUserById(result.lastInsertRowid);
  } catch (error) {
    logger.error("Failed to create user:", error);
    throw new Error(`Failed to create user: ${error.message}`);
  }
}

/**
 * Get user by ID
 *
 * @param {number} userId - User ID
 * @returns {Object|null} User object or null if not found
 */
function getUserById(userId) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        party_id,
        client_id,
        email,
        first_name,
        last_name,
        created_at,
        updated_at
      FROM users
      WHERE id = ?
    `);

    const user = stmt.get(userId);
    return user || null;
  } catch (error) {
    logger.error(`Failed to get user by ID ${userId}:`, error);
    throw new Error(`Failed to get user: ${error.message}`);
  }
}

/**
 * Get user by identifier (username/phone)
 *
 * @param {string} userIdentifier - User identifier
 * @returns {Object|null} User object or null if not found
 */
function getUserByIdentifier(userIdentifier) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        party_id,
        client_id,
        email,
        first_name,
        last_name,
        created_at,
        updated_at
      FROM users
      WHERE user_id = ?
    `);

    const user = stmt.get(userIdentifier);
    return user || null;
  } catch (error) {
    logger.error(`Failed to get user by identifier ${userIdentifier}:`, error);
    throw new Error(`Failed to get user: ${error.message}`);
  }
}

/**
 * Update user information
 *
 * @param {number} userId - User ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.partyId] - Party ID
 * @param {string} [updates.clientId] - Client ID
 * @param {string} [updates.email] - Email
 * @param {string} [updates.firstName] - First name
 * @param {string} [updates.lastName] - Last name
 * @returns {Object} Updated user object
 * @throws {Error} If update fails
 */
function updateUser(userId, updates) {
  try {
    const db = dbConnection.getDatabase();

    // Build dynamic update query
    const allowedFields = ["party_id", "client_id", "email", "first_name", "last_name"];
    const updateFields = [];
    const values = [];

    // Map camelCase to snake_case
    const fieldMap = {
      partyId: "party_id",
      clientId: "client_id",
      email: "email",
      firstName: "first_name",
      lastName: "last_name",
    };

    Object.keys(updates).forEach((key) => {
      const dbField = fieldMap[key] || key;
      if (allowedFields.includes(dbField)) {
        updateFields.push(`${dbField} = ?`);
        values.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      throw new Error("No valid fields to update");
    }

    // Add updated_at timestamp in ISO 8601 format with timezone offset
    updateFields.push("updated_at = ?");
    values.push(getLocalISOString());
    values.push(userId);

    const sql = `
      UPDATE users
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;

    const stmt = db.prepare(sql);
    const result = stmt.run(...values);

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    logger.info(`User ${userId} updated`);

    return getUserById(userId);
  } catch (error) {
    logger.error(`Failed to update user ${userId}:`, error);
    throw new Error(`Failed to update user: ${error.message}`);
  }
}

/**
 * Get all users with pagination and search
 *
 * @param {number} [page=1] - Page number (1-indexed)
 * @param {number} [limit=50] - Results per page
 * @param {string} [searchTerm=''] - Search term for filtering
 * @returns {Object} Paginated users result
 * @returns {Array} .users - Array of user objects
 * @returns {number} .total - Total count
 * @returns {number} .page - Current page
 * @returns {number} .limit - Results per page
 * @returns {number} .totalPages - Total number of pages
 */
function getAllUsers(page = 1, limit = 50, searchTerm = "") {
  try {
    const db = dbConnection.getDatabase();

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = "";
    const params = [];

    if (searchTerm && searchTerm.trim()) {
      whereClause = `
        WHERE 
          user_id LIKE ? OR
          party_id LIKE ? OR
          client_id LIKE ? OR
          email LIKE ? OR
          first_name LIKE ? OR
          last_name LIKE ?
      `;
      const searchPattern = `%${searchTerm.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`);
    const { total } = countStmt.get(...params);

    // Get paginated results
    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        party_id,
        client_id,
        email,
        first_name,
        last_name,
        created_at,
        updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const users = stmt.all(...params, limitNum, offset);

    const totalPages = Math.ceil(total / limitNum);

    return {
      users,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
    };
  } catch (error) {
    logger.error("Failed to get all users:", error);
    throw new Error(`Failed to get users: ${error.message}`);
  }
}

/**
 * Delete a user (soft delete by setting flags, or hard delete)
 * Note: ON DELETE CASCADE will handle related sessions and requests
 *
 * @param {number} userId - User ID to delete
 * @returns {boolean} True if deleted
 */
function deleteUser(userId) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare("DELETE FROM users WHERE id = ?");
    const result = stmt.run(userId);

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    logger.info(`User ${userId} deleted`);
    return true;
  } catch (error) {
    logger.error(`Failed to delete user ${userId}:`, error);
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}

/**
 * Check if user exists by identifier
 *
 * @param {string} userIdentifier - User identifier to check
 * @returns {boolean} True if user exists
 */
function userExists(userIdentifier) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare("SELECT 1 FROM users WHERE user_id = ?");
    const result = stmt.get(userIdentifier);

    return !!result;
  } catch (error) {
    logger.error(`Failed to check if user exists: ${userIdentifier}`, error);
    throw new Error(`Failed to check user existence: ${error.message}`);
  }
}

/**
 * Get or create user by identifier
 * Useful for session creation when user might not exist yet
 *
 * @param {string} userIdentifier - User identifier
 * @param {Object} [userData={}] - Additional user data if creating
 * @returns {Object} User object
 */
function getOrCreateUser(userIdentifier, userData = {}) {
  try {
    let user = getUserByIdentifier(userIdentifier);

    if (!user) {
      user = createUser(userIdentifier, userData.partyId, userData.clientId, userData.email, userData.firstName, userData.lastName);
    }

    return user;
  } catch (error) {
    logger.error(`Failed to get or create user: ${userIdentifier}`, error);
    throw new Error(`Failed to get or create user: ${error.message}`);
  }
}

module.exports = {
  createUser,
  getUserById,
  getUserByIdentifier,
  updateUser,
  getAllUsers,
  deleteUser,
  userExists,
  getOrCreateUser,
};
