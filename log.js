const winston = require("winston");
const { logging: loggingSettings } = require("./settings");

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
      filename: "logs/main.log",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
};
const logger = winston.createLogger(logConfiguration);
console.log("logging level", logger_level);
module.exports = logger;
