const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");

dotenv.config();
const secret = process.env.TOKEN_SECRET;

const generateAccessToken = (username) => {
  return jwt.sign({ username }, secret, { expiresIn: "1800s" });
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, secret, (err, user) => {
    if (err) {
      console.log(err);
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

module.exports = { generateAccessToken, authenticateToken };
