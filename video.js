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
const { getVideoCodec, getAudioCodec } = require("./codec");

const exec = util.promisify(child_process.exec);

function filepath(file) {
  return file.includes(" ") ? `"${file}"` : file;
}

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
      const fileNum = parseInt(file.replace("out", ""));
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

class Video {
  constructor(file, duration = 0) {
    this.file = file;
    this.duration = duration;
  }
}

class VideoProcessor {
  source = null;
  destination = null;
  binaries;
  remux_mode_enabled;
  remux_mode_available;

  constructor(binaries) {
    this.binaries = binaries;
    this.remux_mode_enabled = videoSettings.remux_mode;
    this.remux_mode_available = false;
  }

  get remux_mode() {
    return this.remux_mode_available && this.remux_mode_enabled;
  }

  async load(file) {
    const command = `${filepath(
      this.binaries.ffprobe.path
    )} -v quiet -show_error -print_format json -show_format ${filepath(file)}`;
    logger.debug(command);
    const { stdout } = await exec(command);
    return new Promise(async (resolve, reject) => {
      const result = JSON.parse(stdout);
      // invalid read
      if (result.error !== undefined || result.format.duration === undefined) {
        reject(new Error("Not a Supported Video File"));
      }
      // everything ok
      this.source = new Video(file, result.format.duration);
      // try remux 5 sec clip to enable or disable remux mode
      try {
        var tempDir = fs.mkdtempSync(
          path.join(path.dirname(this.source.file), ".edl-")
        );
        const test_command = this.remux_format(
          this.source.file,
          "-",
          [new Filter(0, 5, Filter.Types.CUT)],
          "",
          tempDir,
          this.source.duration,
          0,
          2.5
        )
          .map((cmd) => cmd.command)
          .join(" && ");

        await exec(test_command);
        const rl = readline.createInterface({
          input: fs.createReadStream(path.join(tempDir, "out.csv")),
          crlfDelay: Infinity,
        });
        this.remux_mode_available = true;
        for await (const line of rl) {
          const [file, start, end] = line.trim().split(",");
          if (parseFloat(end) == 0) {
            logger.error("Could not cut video. Disabling remux mode");
            this.remux_mode_available = false;
          }
        }
      } catch (error) {
        logger.error(error);
        this.remux_mode_available = false;
      } finally {
        // cleanup temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      const outputFilename = `${path.basename(
        file,
        path.extname(file)
      )}_merged${path.extname(file)}`;

      const outputDir = this.destination
        ? path.dirname(this.destination.file)
        : path.dirname(file);
      this.destination = new Video(path.join(outputDir, outputFilename));

      logger.debug(`duration: ${this.source.duration}`);
      resolve(file);
    });
  }

  async getNextKeyFrame(seconds) {
    let delta = 5.0;
    while (true) {
      const start = delta < seconds && seconds > 0 ? seconds - delta : 0;
      const end = seconds > 0 ? seconds + delta : delta;
      const args = [
        filepath(this.binaries.ffprobe.path),
        `-read_intervals ${start}%${end}`,
        "-v error -skip_frame nokey -show_entries",
        "frame=best_effort_timestamp_time -select_streams v -of json",
        filepath(this.source.file),
      ];
      const command = args.join(" ");
      logger.debug(command);
      const { stdout } = await exec(command);
      const { frames } = JSON.parse(stdout);
      const frame = frames
        .slice(1)
        .find(
          ({ best_effort_timestamp_time }) =>
            seconds <= parseFloat(best_effort_timestamp_time)
        );
      if (frame) {
        const { best_effort_timestamp_time: time } = frame;
        return parseFloat(time);
      } else if (end >= this.source.duration) {
        return this.source.duration;
      }
      delta += 5.0;
    }
  }

  async getPrevKeyFrame(seconds) {
    let delta = 5.0;
    while (true) {
      const start = delta < seconds && seconds > 0 ? seconds - delta : 0;
      const end = seconds > 0 ? seconds + delta : delta;
      const args = [
        filepath(this.binaries.ffprobe.path),
        `-read_intervals ${start}%${end}`,
        "-v error -skip_frame nokey -show_entries",
        "frame=best_effort_timestamp_time -select_streams v -of json",
        filepath(this.source.file),
      ];
      const command = args.join(" ");
      logger.debug(command);
      const { stdout } = await exec(command);
      const { frames } = JSON.parse(stdout);
      const frame = frames
        .slice(1)
        .reverse()
        .find(
          ({ best_effort_timestamp_time }) =>
            seconds > parseFloat(best_effort_timestamp_time)
        );
      if (frame) {
        const { best_effort_timestamp_time: time } = frame;
        return parseFloat(time);
      } else if (start == 0) {
        return 0;
      }
      delta += 5.0;
    }
  }

  transcode_format(
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
      ? `-vf "select='${cuts}',setpts=N/FRAME_RATE/TB" ${getVideoCodec()}`
      : "-c:v copy";
    // audio is always processed either for mutes or to match the cut video
    const audioFilter = `-af "${audioArgs.join(",")}" ${getAudioCodec()}`;
    const command = `${filepath(this.binaries.ffmpeg.path)} -y ${
      start ? "-ss " + start + " -noaccurate_seek -copyts" : ""
    } ${end ? "-to " + end : ""} ${progress} -i ${filepath(
      input
    )} -v error ${videoFilter} ${audioFilter} ${filepath(output)}`;

    return [new VideoJob(command, duration, edits)];
  }

  remux_format(input, output, edits, progress, tempDir, duration, start, end) {
    // process filters
    const cuts = edits.filter((edit) => edit.type === Filter.Types.CUT);
    const mutes = edits.filter((edit) => edit.type === Filter.Types.MUTE);
    let commands = [];

    if (mutes.length) {
      const transcodeOut = cuts.length
        ? path.join(tempDir, `audio${path.extname(input)}`)
        : output;
      commands = this.transcode_format(
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
      const segmentList = path.join(tempDir, "out.csv");
      const segmentOut = path.join(tempDir, `out%03d${path.extname(input)}`);
      const videoFilter = cuts
        .reduce((list, edit) => list.concat([edit.start, edit.end]), [])
        .filter((val) => parseFloat(val) > 0 && parseFloat(val) < duration)
        .join(",");
      const command = `${filepath(this.binaries.ffmpeg.path)} -y ${
        start ? "-ss " + start + " -copyts -start_at_zero" : ""
      } ${end ? "-to " + end : ""} ${progress} -i ${filepath(
        input
      )} -v error -c:v copy ${getAudioCodec()} -map 0:v:0 -map 0:a -f segment -segment_list ${filepath(
        segmentList
      )} -reset_timestamps 1 -segment_times ${videoFilter} ${filepath(
        segmentOut
      )}`;
      commands.push(new VideoJob(command, duration, cuts));
    }
    return commands;
  }

  async preview(filters, padding, progress = "") {
    const previewFile =
      uniqueFilename(path.dirname(this.destination.file), ".preview") +
      path.extname(this.source.file);

    const windowArgs = '-alwaysontop -window_title "Filter Preview"';
    const command = `${filepath(
      this.binaries.ffplay.path
    )} ${windowArgs} -i ${filepath(previewFile)}`;

    // normalize filters for remux mode
    const filter_start =
      this.remux_mode && filters[0].startKeyFrame
        ? parseFloat(filters[0].startKeyFrame)
        : parseFloat(filters[0].start);
    const filter_end =
      this.remux_mode && filters[filters.length - 1].endKeyFrame
        ? parseFloat(filters[filters.length - 1].endKeyFrame)
        : parseFloat(filters[filters.length - 1].end);

    const sTime = filter_start - padding;
    const eTime = filter_end + padding;

    const start = this.remux_mode ? await this.getPrevKeyFrame(sTime) : sTime;
    const end = this.remux_mode ? await this.getNextKeyFrame(eTime) : eTime;
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
          resolve(val);
        })
        .catch((error) => {
          reject(error);
        })
        .finally(() => {
          // cleanup preview file
          fs.rmSync(previewFile, { force: true });
        });
    });
  }

  merge({ output, filters, progress, start = null, end = null }) {
    // prep work dir and commands
    try {
      var tempDir = fs.mkdtempSync(path.join(path.dirname(output), ".edl-"));
    } catch (error) {
      return new Promise((resolve, reject) => {
        reject(error);
      });
    }

    const args = [
      this.source.file,
      output,
      filters,
      progress,
      tempDir,
      this.source.duration,
      start,
      end,
    ];
    const commands = this.remux_mode
      ? this.remux_format(...args)
      : this.transcode_format(...args);
    logger.debug(commands);

    // generate file
    const command = commands.map((cmd) => cmd.command).join(" && ");
    logger.debug(command);
    const cuts = filters.filter((edit) => edit.type === Filter.Types.CUT);
    const needsJoin = this.remux_mode && cuts.length > 0;
    if (needsJoin) {
      const joinCommand = `${filepath(
        this.binaries.ffmpeg.path
      )} -y ${progress} -f concat -safe 0 -i ${filepath(
        path.join(tempDir, "join.txt")
      )} -c copy ${filepath(output)}`;
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
          .catch((err) => {
            reject(err); // cleanup temp dir
            fs.rmSync(tempDir, { recursive: true, force: true });
          });
      }),
    };
  }
}

module.exports = VideoProcessor;
