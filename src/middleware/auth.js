const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Admin = require("../models/Admin");
const ApiError = require("../utils/apiError");
const { verifyToken } = require("../utils/jwt");
const { ROLE } = require("../constants/vaccine");

/**
 * Verifies the bearer token and confirms the principal still exists.
 *
 * The existence check costs one `_id` lookup, and the document it loads is
 * attached to the request so downstream handlers do not have to fetch it again
 * - so in practice it adds no queries. Without it, a token issued to a user who
 * has since been removed would keep working until it expired.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(
      ApiError.unauthorized(
        "Authentication token is required. Send an 'Authorization: Bearer <token>' header.",
        "TOKEN_MISSING"
      )
    );
  }

  const token = header.slice("Bearer ".length).trim();

  if (!token) {
    return next(
      ApiError.unauthorized("Authentication token is empty", "TOKEN_MISSING")
    );
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(
        ApiError.unauthorized(
          "Authentication token has expired. Please log in again.",
          "TOKEN_EXPIRED"
        )
      );
    }
    return next(
      ApiError.unauthorized(
        "Authentication token is invalid or malformed",
        "TOKEN_INVALID"
      )
    );
  }

  req.auth = { id: decoded.sub, role: decoded.role };

  const isAdmin = decoded.role === ROLE.ADMIN;
  const query = isAdmin
    ? Admin.findById(decoded.sub).select("name phoneNumber role")
    : User.findById(decoded.sub);

  query
    .then((principal) => {
      if (!principal) {
        return next(
          ApiError.unauthorized(
            "The account associated with this token no longer exists",
            "PRINCIPAL_NOT_FOUND"
          )
        );
      }

      if (isAdmin) {
        req.admin = principal;
      } else {
        req.user = principal;
      }

      return next();
    })
    .catch(next);
}

function requireRole(role) {
  return function roleGuard(req, res, next) {
    if (!req.auth || req.auth.role !== role) {
      return next(
        ApiError.forbidden(
          `This endpoint requires the ${role} role`,
          "INSUFFICIENT_ROLE"
        )
      );
    }
    return next();
  };
}

const requireAdmin = requireRole(ROLE.ADMIN);
const requireUser = requireRole(ROLE.USER);

module.exports = { authenticate, requireRole, requireAdmin, requireUser };
