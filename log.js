const winston = require("winston");
const fs = require("fs");
const path = require("path");
const { logging: loggingSettings } = require("./settings");
const { Filter } = require("./edl");

const log_dir = path.join(__dirname, "logs");
const levels = ["error", "info", "verbose", "debug"];
const logger_level = levels.includes(loggingSettings.level)
  ? loggingSettings.level
  : "info";
const logConfiguration = {
  transports: [
    new winston.transports.File({
      level: logger_level,
      maxsize: 3000000,
      maxFiles: 1,
      tailable: true,
      filename: path.join(log_dir, "edl.log"),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
};
/*
  rotate files manually as Winston does not have 
  a transport for rotating files per run like we want
*/
const logfiles = fs
  .readdirSync(log_dir)
  .filter((file) => file.match(/edl[1-4]?.log/g)) // 5 logs max
  .reverse();
// rotate
logfiles.forEach((file) => {
  const number = file[3] === "." ? 1 : parseInt(file[3]) + 1;
  fs.renameSync(
    path.join(log_dir, file),
    path.join(log_dir, `edl${number}.log`)
  );
});

const logger = winston.createLogger(logConfiguration);
logger.info("logging level", logger_level);
module.exports = logger;
