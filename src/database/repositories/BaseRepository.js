/**
 * BaseRepository - Base class for all repositories
 *
 * Purpose:
 * - Provide common CRUD operations
 * - Handle database transactions
 * - Support query building
 * - Enable pagination and filtering
 * - Centralize error handling
 *
 * Usage:
 * class UserRepository extends BaseRepository {
 *   constructor(db) {
 *     super(db, 'users');
 *   }
 * }
 */

class BaseRepository {
  /**
   * @param {Database} db - Database instance
   * @param {string} tableName - Table name
   */
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
  }

  /**
   * Find record by ID
   * @param {number} id - Record ID
   * @returns {Promise<Object|null>} Record or null
   */
  async findById(id) {
    const sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
    return await this.db.get(sql, [id]);
  }

  /**
   * Find all records
   * @param {Object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Array of records
   */
  async findAll(options = {}) {
    let sql = `SELECT * FROM ${this.tableName}`;
    const params = [];

    // Add WHERE clause if conditions provided
    if (options.where) {
      const { clause, values } = this._buildWhereClause(options.where);
      sql += ` WHERE ${clause}`;
      params.push(...values);
    }

    // Add ORDER BY
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
      if (options.orderDir) {
        sql += ` ${options.orderDir}`;
      }
    }

    // Add LIMIT and OFFSET
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }

    return await this.db.all(sql, params);
  }

  /**
   * Find one record by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} Record or null
   */
  async findOne(criteria) {
    const { clause, values } = this._buildWhereClause(criteria);
    const sql = `SELECT * FROM ${this.tableName} WHERE ${clause} LIMIT 1`;
    return await this.db.get(sql, values);
  }

  /**
   * Find records by criteria
   * @param {Object} criteria - Search criteria
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of records
   */
  async findBy(criteria, options = {}) {
    const { clause, values } = this._buildWhereClause(criteria);
    let sql = `SELECT * FROM ${this.tableName} WHERE ${clause}`;

    // Add ORDER BY
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
      if (options.orderDir) {
        sql += ` ${options.orderDir}`;
      }
    }

    // Add LIMIT
    if (options.limit) {
      sql += ` LIMIT ?`;
      values.push(options.limit);
    }

    return await this.db.all(sql, values);
  }

  /**
   * Create new record
   * @param {Object} data - Record data
   * @returns {Promise<number>} Inserted record ID
   */
  async create(data) {
    const { columns, placeholders, values } = this._buildInsertData(data);
    const sql = `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders})`;
    const result = await this.db.run(sql, values);
    return result.lastInsertRowid;
  }

  /**
   * Update record by ID
   * @param {number} id - Record ID
   * @param {Object} data - Updated data
   * @returns {Promise<number>} Number of affected rows
   */
  async update(id, data) {
    const { setClause, values } = this._buildUpdateData(data);
    values.push(id);
    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
    const result = await this.db.run(sql, values);
    return result.changes;
  }

  /**
   * Update records by criteria
   * @param {Object} criteria - Update criteria
   * @param {Object} data - Updated data
   * @returns {Promise<number>} Number of affected rows
   */
  async updateBy(criteria, data) {
    const { setClause, values: updateValues } = this._buildUpdateData(data);
    const { clause: whereClause, values: whereValues } = this._buildWhereClause(criteria);

    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${whereClause}`;
    const result = await this.db.run(sql, [...updateValues, ...whereValues]);
    return result.changes;
  }

  /**
   * Delete record by ID
   * @param {number} id - Record ID
   * @returns {Promise<number>} Number of deleted rows
   */
  async delete(id) {
    const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
    const result = await this.db.run(sql, [id]);
    return result.changes;
  }

  /**
   * Delete records by criteria
   * @param {Object} criteria - Delete criteria
   * @returns {Promise<number>} Number of deleted rows
   */
  async deleteBy(criteria) {
    const { clause, values } = this._buildWhereClause(criteria);
    const sql = `DELETE FROM ${this.tableName} WHERE ${clause}`;
    const result = await this.db.run(sql, values);
    return result.changes;
  }

  /**
   * Count records
   * @param {Object} criteria - Count criteria (optional)
   * @returns {Promise<number>} Record count
   */
  async count(criteria = null) {
    let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;
    let params = [];

    if (criteria) {
      const { clause, values } = this._buildWhereClause(criteria);
      sql += ` WHERE ${clause}`;
      params = values;
    }

    const result = await this.db.get(sql, params);
    return result.count;
  }

  /**
   * Check if record exists
   * @param {Object} criteria - Existence criteria
   * @returns {Promise<boolean>} True if exists
   */
  async exists(criteria) {
    const count = await this.count(criteria);
    return count > 0;
  }

  /**
   * Execute raw SQL query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    return await this.db.all(sql, params);
  }

  /**
   * Execute raw SQL statement
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<Object>} Statement result
   */
  async execute(sql, params = []) {
    return await this.db.run(sql, params);
  }

  /**
   * Begin transaction
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    await this.db.run("BEGIN TRANSACTION");
  }

  /**
   * Commit transaction
   * @returns {Promise<void>}
   */
  async commit() {
    await this.db.run("COMMIT");
  }

  /**
   * Rollback transaction
   * @returns {Promise<void>}
   */
  async rollback() {
    await this.db.run("ROLLBACK");
  }

  /**
   * Build WHERE clause from criteria object
   * @private
   */
  _buildWhereClause(criteria) {
    const conditions = [];
    const values = [];

    for (const [key, value] of Object.entries(criteria)) {
      if (value === null) {
        conditions.push(`${key} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => "?").join(", ");
        conditions.push(`${key} IN (${placeholders})`);
        values.push(...value);
      } else if (typeof value === "object" && value.operator) {
        // Support operators: { operator: '>=', value: 10 }
        conditions.push(`${key} ${value.operator} ?`);
        values.push(value.value);
      } else {
        conditions.push(`${key} = ?`);
        values.push(value);
      }
    }

    return {
      clause: conditions.join(" AND "),
      values,
    };
  }

  /**
   * Build INSERT data
   * @private
   */
  _buildInsertData(data) {
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);

    return { columns, placeholders, values };
  }

  /**
   * Build UPDATE SET clause
   * @private
   */
  _buildUpdateData(data) {
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = Object.values(data);

    return { setClause, values };
  }
}

module.exports = BaseRepository;
