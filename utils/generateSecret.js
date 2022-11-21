// copy and paste into env
const secret = require("crypto").randomBytes(64).toString("hex");
console.log("TOKEN_SECRET", secret);
