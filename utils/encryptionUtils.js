const dotenv = require("dotenv");
const crypto = require("crypto");

dotenv.config();
const secret = process.env.TOKEN_SECRET;
const key = Buffer.alloc(32, secret, "hex");

const algorithm = "aes-256-cbc";
const initVector = Buffer.alloc(16, secret, "hex");

const encrypt = (password) => {
  const cipher = crypto.createCipheriv(algorithm, key, initVector);
  let encrypted = cipher.update(password, "utf-8", "hex");
  encrypted += cipher.final("hex");

  return encrypted;
};

const decrypt = (encryptedData) => {
  const decipher = crypto.createDecipheriv(algorithm, key, initVector);
  let decrypted = decipher.update(encryptedData, "hex", "utf-8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

module.exports = { encrypt, decrypt };
