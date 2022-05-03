const { video: videoSettings } = require("./settings");
const logger = require("./log");

const videoCodecs = { auto: "" };
const audioCodecs = { aac: "-c:a aac" };

function getVideoCodec() {
  if (!Object.keys(videoCodecs).includes(videoSettings.video)) {
    logger.error("unsupported video codec, using default");
    return videoCodecs["auto"];
  }
  return videoCodecs[videoSettings.video];
}
function getAudioCodec() {
  if (!Object.keys(audioCodecs).includes(videoSettings.audio)) {
    logger.error("unsupported audio codec, using default");
    return audioCodecs["aac"];
  }
  return audioCodecs[videoSettings.audio];
}

exports = module.exports;
exports.getVideoCodec = getVideoCodec;
exports.getAudioCodec = getAudioCodec;
