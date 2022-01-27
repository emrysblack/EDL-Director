const ProgressBar = require("electron-progressbar");
const path = require("path");
const http = require("http");
const logger = require("./log");

class FFmpegProgressBar {
  constructor(window = null, text) {
    this.jobs = [];
    this.job = 0;
    this.window = window;
    this.text = text;
    this.progressBar = null;
    this.srv = http.createServer((req, res) => {
      req.on("data", (chunk) => {
        // convert input to Object
        const data = Object.fromEntries(
          chunk
            .toString()
            .split("\n")
            .filter((entry) => entry.length)
            .map((entry) => entry.split("="))
        );
        const elapsed = parseInt(data["out_time_us"]); // microseconds
        this.updatePercent(elapsed);
      });
      req.on("end", () => {
        if (this.job >= this.jobs.length - 1) {
          if (this.progressBar.isInProgress()) {
            this.progressBar.setCompleted();
          }
          //this.progressBar.close();
          logger.info("done");
        }
        this.job++;
        res.writeHead(200);
        res.end("OK");
      });
    });
  }

  setupProgressBar = () => {
    logger.info(`Saving file`);
    this.progressBar = new ProgressBar({
      indeterminate: false,
      title: "Saving Video",
      text: this.text,
      detail: "Processing...",
      maxValue: 100,
      browserWindow: {
        frame: false,
        icon: path.join(__dirname, "icon.png"),
        parent: this.window,
      },
    });
  };

  updatePercent = (data) => {
    if (!this.progressBar) {
      this.setupProgressBar();
    }
    if (this.progressBar.isInProgress()) {
      // hack the progress bar a bit to get better stuffs
      const determinate = this.jobs.length && this.jobs[this.job].duration;
      this.progressBar._options.indeterminate = !determinate;
      if (determinate) {
        const value =
          this.jobs
            .slice(0, this.job)
            .reduce((acc, job) => acc + job.duration, 0) + data;
        const maxValue = this.jobs.reduce((acc, job) => acc + job.duration, 0);
        this.progressBar.detail = this.jobs.length
          ? this.jobs[this.job].message
          : "";
        this.progressBar.value = (value / maxValue) * 100;
      }
    }
  };

  async getServerAddress() {
    if (!this.srv.listening) {
      await this.srv.listen(0, "127.0.0.1");
      logger.debug(
        "Listening for FFMpeg on: " +
          this.srv.address().address +
          ":" +
          this.srv.address().port
      );
    }
    return `http://${this.srv.address().address}:${this.srv.address().port}/`;
  }
  set tasks(value) {
    this.jobs = value;
    this.job = 0;
  }
}

module.exports = FFmpegProgressBar;
