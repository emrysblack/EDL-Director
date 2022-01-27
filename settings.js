const fs = require("fs");
const ini = require("ini");

const defaultIni = "./default.ini";
const userIni = "./user.ini";

try {
  fs.copyFileSync(defaultIni, userIni, fs.constants.COPYFILE_EXCL);
} catch (error) {
  console.log(`File exists: ${userIni}`);
}

const config = ini.parse(fs.readFileSync(userIni, "utf-8"));
module.exports = config;
