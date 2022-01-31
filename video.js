const fs = require("fs");
const readline = require("readline");
const path = require("path");
const child_process = require("child_process");
const util = require("util");
const { video: videoSettings } = require("./settings");
const logger = require("./log");
const { Filter } = require("./edl");
const { input } = require("./log");
const uniqueFilename = require("unique-filename");

const exec = util.promisify(child_process.exec);

async function generateJoinFile(edits, tempDir) {
  const fileContents = [];
  const cut = edits.find((edit) => edit.type === Filter.Types.CUT);
  if (cut) {
    const fileStream = fs.createReadStream(path.join(tempDir, "out.csv"));
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    let fileIndex = parseFloat(cut.start) > 0 ? 0 : 1; // odds or evens
    for await (const line of rl) {
      const [file, start, end] = line.trim().split(",");
      const fileNum = parseInt(file.replace("out", "").replace(".nut", ""));
      if ((fileNum + 2) % 2 == fileIndex) {
        fileContents.push(`file ${file}`);
      }
    }
    fs.writeFileSync(path.join(tempDir, "join.txt"), fileContents.join("\n"));
  }
  return fileContents;
}
class VideoJob {
  constructor(command, duration, edits) {
    const jobTypes = [
      ...new Set(
        edits.map((edit) =>
          edit.type === Filter.Types.MUTE ? "Audio" : "Video"
        )
      ),
    ].sort();
    this.command = command;
    this.duration = duration * 1000000; // convert to microseconds
    this.message = `Processing ${jobTypes.join(" and ")}...`;
  }
}
function transcode_format(
  ff,
  input,
  output,
  edits,
  progress,
  tempDir,
  duration,
  start,
  end
) {
  const formatCuts = (cuts) =>
    cuts.map((edit) => `not(between(t,${edit.start},${edit.end}))`).join("*");
  const formatMutes = (mutes) =>
    mutes.map((edit) => `between(t,${edit.start},${edit.end})`).join("+");

  const audioArgs = [];

  // process filters
  const cuts = formatCuts(
    edits.filter((edit) => edit.type === Filter.Types.CUT)
  );
  const mutes = formatMutes(
    edits.filter((edit) => edit.type === Filter.Types.MUTE)
  );

  if (mutes.length) {
    audioArgs.push(`volume=enable='${mutes}':volume=0`);
  }
  if (cuts.length) {
    audioArgs.push(`aselect='${cuts}',asetpts=N/SR/TB`);
  }
  const videoFilter = cuts.length
    ? `-vf "select='${cuts}',setpts=N/FRAME_RATE/TB"`
    : "-c:v copy";
  // audio is always processed either for mutes or to match the cut video
  const audioFilter = `-af "${audioArgs.join(",")}" -c:a aac`;
  const command = `"${ff}" -y ${
    start ? "-ss " + start + " -noaccurate_seek -copyts" : ""
  } ${
    end ? "-to " + end : ""
  } ${progress} -i ${input} ${videoFilter} ${audioFilter} ${output}`;

  return [new VideoJob(command, duration, edits)];
}

function remux_format(
  ff,
  input,
  output,
  edits,
  progress,
  tempDir,
  duration,
  start,
  end
) {
  // process filters
  const cuts = edits.filter((edit) => edit.type === Filter.Types.CUT);
  const mutes = edits.filter((edit) => edit.type === Filter.Types.MUTE);
  let commands = [];

  if (mutes.length) {
    const transcodeOut = cuts.length
      ? `${tempDir}${path.sep}audio.nut`
      : output;
    commands = transcode_format(
      ff,
      input,
      transcodeOut,
      mutes,
      progress,
      tempDir,
      duration,
      start,
      end
    );
    input = transcodeOut;
  }
  if (cuts.length) {
    const segmentList = `-segment_list ${path.join(tempDir, "out.csv")}`;
    const segmentOut = path.join(tempDir, "out%03d.nut");
    const videoFilter = cuts
      .reduce((list, edit) => list.concat([edit.start, edit.end]), [])
      .filter((val) => parseFloat(val) > 0 && parseFloat(val) < duration)
      .join(",");
    const command = `"${ff}" -y ${
      start ? "-ss " + start + " -copyts -start_at_zero" : ""
    } ${
      end ? "-to " + end : ""
    } ${progress} -i ${input} -codec copy -map 0 -f segment ${segmentList} -reset_timestamps 1 -segment_times ${videoFilter} ${segmentOut}`;
    commands.push(new VideoJob(command, duration, cuts));
  }
  return commands;
}

class Video {
  constructor(file) {
    this.file = file;
    this.duration = 0;
  }
  get filename() {
    return this.file.substring(this.file.lastIndexOf(path.sep) + 1);
  }
  get dir() {
    return this.file.substring(0, this.file.lastIndexOf(path.sep));
  }
  get ext() {
    return this.filename.substring(this.filename.lastIndexOf("."));
  }
}

class VideoProcessor {
  source = null;
  destination = null;
  binaries;
  strict_mode;

  constructor(binaries) {
    this.binaries = binaries;
    this.strict_mode = videoSettings.strict_mode;
  }

  async load(file) {
    const command = `"${this.binaries.ffprobe.path}" -v quiet -show_error -print_format json -show_format "${file}"`;
    logger.debug(command);
    const { stdout } = await exec(command);
    return new Promise((resolve, reject) => {
      const result = JSON.parse(stdout);
      // invalid read
      if (result.error !== undefined || result.format.duration === undefined) {
        reject(new Error("Not a Supported Video File"));
      }
      // everything ok
      this.source = new Video(file);
      this.source.duration = result.format.duration;
      const outputFilename = `${this.source.filename.substring(
        0,
        this.source.filename.lastIndexOf(".")
      )}_merged${this.source.ext}`;

      const outputDir = this.destination
        ? this.destination.dir
        : file.substring(0, file.lastIndexOf(path.sep));
      this.destination = new Video(path.join(outputDir, outputFilename));

      logger.debug(`duration: ${this.source.duration}`);
      resolve(file);
    });
  }

  async preview(filters, padding, progress = "") {
    const previewFile =
      uniqueFilename(this.destination.dir, "preview") + this.source.ext;

    const windowArgs = '-alwaysontop -window_title "Filter Preview"';
    const command = `"${this.binaries.ffplay.path}" ${windowArgs} -i "${previewFile}"`;
    const start = parseFloat(filters[0].start) - padding;
    const end = parseFloat(filters[filters.length - 1].end) + padding;
    const { process } = this.merge({
      output: previewFile,
      filters: filters,
      progress: progress,
      start: start > 0 ? start : 0,
      end: end < this.source.duration ? end : this.source.duration,
    });
    await process;

    return new Promise((resolve, reject) => {
      exec(command)
        .then((val) => {
          // cleanup preview file
          fs.rmSync(previewFile, { force: true });
          resolve(val);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  merge({ output, filters, progress, start = null, end = null }) {
    // prep work dir and commands
    try {
      var tempDir = fs.mkdtempSync(path.join(path.dirname(output), "edl-"));
    } catch (error) {
      return new Promise((resolve, reject) => {
        reject(error);
      });
    }

    const format = this.strict_mode ? transcode_format : remux_format;
    const commands = format(
      this.binaries.ffmpeg.path,
      `"${this.source.file}"`,
      `"${output}"`,
      filters,
      progress,
      `"${tempDir}"`,
      this.source.duration,
      start,
      end
    );
    logger.debug(commands);

    // generate file
    const command = commands.map((cmd) => cmd.command).join(" && ");
    logger.debug(command);
    const cuts = filters.filter((edit) => edit.type === Filter.Types.CUT);
    const needsJoin = !this.strict_mode && cuts.length > 0;
    if (needsJoin) {
      const joinCommand = `"${this.binaries.ffmpeg.path}" -y ${progress} -f concat -safe 0 -i "${tempDir}${path.sep}join.txt" -c copy "${output}"`;
      commands.push(new VideoJob(joinCommand, this.source.duration, cuts));
    }
    return {
      jobs: commands,
      process: new Promise(async (resolve, reject) => {
        exec(command)
          .then((val) => {
            // write join file
            fs.access(
              path.join(tempDir, "out.csv"),
              fs.constants.F_OK,
              async (err) => {
                if (!err) {
                  const fileContents = await generateJoinFile(filters, tempDir);
                  logger.debug(fileContents);
                  try {
                    const joinCommand = commands[commands.length - 1].command;
                    val = await exec(joinCommand);
                  } catch (error) {
                    reject(error);
                  }
                }
                resolve(val);
                // cleanup temp dir
                fs.rmSync(tempDir, { recursive: true, force: true });
              }
            );
          })
          .catch((err) => reject(err));
      }),
    };
  }
}

module.exports = VideoProcessor;
