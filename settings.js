const fs = require("fs");
const ini = require("ini");
const path = require("path");

const mainIni = path.join(__dirname, "main.ini");
const defaultIni = path.join(__dirname, "default.ini");
const settingsIni = "settings.ini";

try {
  fs.copyFileSync(defaultIni, settingsIni, fs.constants.COPYFILE_EXCL);
} catch (error) {
  console.log(`File exists: ${settingsIni}`);
}

const config = {
  ...ini.parse(fs.readFileSync(mainIni, "utf-8")),
  ...ini.parse(fs.readFileSync(settingsIni, "utf-8")),
};
module.exports = config;
