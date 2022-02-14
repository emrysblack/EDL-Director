const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const ffbinaries = require("ffbinaries");
const ProgressBar = require("electron-progressbar");
const FFmpegProgressBar = require("./ffmpegProgressBar");
const EditDecisionList = require("./edl");
const { Filter } = require("./edl");
const VideoProcessor = require("./video");
const logger = require("./log");

// handle squirrel install
if (require("electron-squirrel-startup")) return app.quit();

logger.debug("starting program");

const ffbinariesList = ["ffmpeg", "ffplay", "ffprobe"];
const binLocation = path.join(__dirname, "bin");
const icon = path.join(__dirname, "icon.png");
let ffBin = null;
let videoProcessor;

let mainWindow;
let messageClient = null;
// listen for app to be ready
function createWindow() {
  mainWindow = new BrowserWindow({
    icon: icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      //nodeIntegration: false,
    },
  });

  mainWindow.loadFile("mainWindow.html");
  // init menu
  const mainMenu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(mainMenu);

  // setup messaging
  mainWindow.webContents.on("did-finish-load", () => {
    messageClient = function (channel, value) {
      mainWindow.webContents.send(channel, value);
    };
    messageClient("remuxMode:init", videoProcessor.remux_mode_enabled);
  });

  // show when ready
  mainWindow.once("ready-to-show", () => {
    logger.debug("show main window");
    mainWindow.show();
  });
}

const menuTemplate = [
  {
    label: "File",
    submenu: [
      {
        label: "Open Video File",
        click() {
          handleVideoFileDialog();
        },
      },
      {
        label: "Open EDL File",
        click() {
          handleEDLFileDialog();
        },
      },
      {
        accelerator: process.platform !== "darwin" ? "Ctrl+Q" : "Command+Q",
        label: "Exit",
        click() {
          app.quit();
        },
      },
    ],
  },
];

app.whenReady().then(() => {
  const initBar = new ProgressBar({
    indeterminate: true,
    title: "EDL Director",
    text: "",
    browserWindow: { frame: false, icon: icon },
  });
  // first run setup
  const downloads = [];
  let progressBar = null;
  const setupProgressBar = () => {
    logger.info("downlading missing dependencies");
    progressBar = new ProgressBar({
      indeterminate: false,
      title: "EDL Director",
      text: "Initializing...",
      detail: "updating binaries...",
      maxValue: 1,
      browserWindow: { frame: false, icon: icon },
    });
  };
  const updatePercent = (data) => {
    if (!progressBar) {
      setupProgressBar();
    }
    const { filename, progress } = data;
    downloads[filename] = progress;
    const totalPercent =
      Object.values(downloads).reduce(
        (total, download) => total + download,
        0
      ) / Object.values(downloads).length;
    logger.debug(`${parseInt(totalPercent * 100)}%`);
    progressBar.value = totalPercent;
  };

  ffbinaries.downloadBinaries(
    ffbinariesList,
    { destination: binLocation, tickerFn: updatePercent },
    function (err, data) {
      initBar.setCompleted();
      if (progressBar) {
        progressBar.setCompleted();
      }

      if (err) {
        logger.error(JSON.stringify(err));
      }
      // everything is ready, start program
      ffBin = ffbinaries.locateBinariesSync(ffbinariesList, {
        paths: [binLocation],
        ensureExecutable: true,
      });
      videoProcessor = new VideoProcessor(ffBin);
      logger.info(`binaries: ${JSON.stringify(ffBin)}`);
      if (Object.values(ffBin).some((bin) => !bin.found)) {
        const error = "Missing dependencies. Check your internet connection.";
        logger.error(error);
        dialog.showErrorBox("Binaries error", error);
        app.exit(1);
      }
      createWindow();
    }
  );

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Mac OS menu fix
if (process.platform == "darwin") {
  menuTemplate.unshift({});
}

// if not live, use dev tools
if (!app.isPackaged) {
  menuTemplate.push({
    label: "Developer Tools",
    submenu: [
      {
        label: "Toggle DevTools",
        click(item, focusedWindow) {
          focusedWindow.toggleDevTools();
        },
      },
    ],
  });
}

const editDecisionList = new EditDecisionList();

// add supported filetypes if we can work out good default codecs
const videoFileTypes = [
  "mp4",
  "m4v",
  "mkv",
  //  "mov",
  //  "mpg",
  //  "mpeg",
  //  "avi",
  //  "wmv",
  //  "flv",
  //  "webm",
];

async function loadEdlFile(edlFile) {
  // Check if the file exists
  fs.access(edlFile, fs.constants.F_OK, (err) => {
    if (err) {
      logger.debug(`${edlFile} does not exist`);
      return;
    }
    editDecisionList
      .load(edlFile)
      .then(() => {
        messageClient("edlText:value", edlFile);
        messageClient("edlFilters:value", editDecisionList.filters);
      })
      .catch((error) => {
        logger.error(error);
        messageClient("edlText:value", error);
      });
  });
}

function checkVideoFile(file) {
  logger.debug(`check file: ${file}`);
  videoProcessor
    .load(file)
    .then((value) => {
      messageClient("videoText:value", value);
      messageClient("outputText:value", videoProcessor.destination.file);
      messageClient("remuxMode:available", videoProcessor.remux_mode_available);
      const defaultEDL = `${value.substring(0, value.lastIndexOf("."))}.edl`;
      loadEdlFile(defaultEDL);
    })
    .catch((error) => {
      dialog.showMessageBox(mainWindow, {
        message: error.message,
        type: "error",
        title: "Error",
        buttons: [],
      });
      logger.error(`Could not parse video ${file}`);
      logger.error(error);
    });
}

async function handleVideoFileDialog() {
  const file = await dialog.showOpenDialog({
    filters: [
      {
        name: "Videos",
        extensions: videoFileTypes,
      },
    ].concat(
      videoFileTypes.map((type) => ({ name: type, extensions: [type] }))
    ),
    properties: ["openFile"],
  });

  if (!file.canceled) {
    logger.debug(`video selected: ${file.filePaths[0]}`);
    checkVideoFile(file.filePaths[0]);
  }
}

function handleOutputDialog() {
  const file = dialog.showSaveDialogSync({
    defaultPath: videoProcessor.destination.file,
    filters: [path.extname(videoProcessor.source.file).substring(1)].map(
      (type) => ({
        name: type,
        extensions: [type],
      })
    ),
    properties: [
      "createDirectory",
      "showOverwriteConfirmation",
      "dontAddToRecent",
    ],
  });
  if (file == videoProcessor.source.file) {
    const error = "Cannot overwrite source file. Choose different target.";
    logger.error(error);
    dialog.showMessageBox(mainWindow, {
      message: error,
      type: "error",
      title: "Error",
      buttons: [],
    });
  } else if (file) {
    logger.debug(`output file selected: ${file}`);
    videoProcessor.destination.file = file;
    messageClient("outputText:value", file);
  }
}

async function handleEDLFileDialog() {
  const file = await dialog.showOpenDialog({
    filters: [
      {
        name: "EDL files",
        extensions: ["edl", "txt"],
      },
    ],
    properties: ["openFile"],
  });

  if (!file.canceled) {
    logger.debug(`edl selected: ${file.filePaths[0]}`);
    const edlFile = file.filePaths[0];
    loadEdlFile(edlFile);
  }
}

async function handleMergeFile() {
  const ffmpegProgressBar = new FFmpegProgressBar(mainWindow, "Saving");
  const progressAddress = await ffmpegProgressBar.getServerAddress();

  // merge
  const { jobs, process } = videoProcessor.merge({
    filters: editDecisionList.filters,
    output: videoProcessor.destination.file,
    progress: `-progress ${progressAddress}`,
  });
  ffmpegProgressBar.tasks = jobs;
  process
    .then(() => {
      ffmpegProgressBar.close();
      dialog.showMessageBox(mainWindow, {
        message: "File Saved Successfully",
        type: "none",
        icon: icon,
        title: "EDL Director",
        buttons: [],
      });
    })
    .catch((error) => {
      logger.error(error.message);
      ffmpegProgressBar.close();
      dialog.showMessageBox(mainWindow, {
        message: "Could not save file",
        type: "error",
        title: "Error",
        buttons: [],
      });
    });
}

async function handlePreviewFile(filter) {
  const ffmpegProgressBar = new FFmpegProgressBar(
    mainWindow,
    "Generating Preview"
  );
  const progressAddress = await ffmpegProgressBar.getServerAddress();

  // ready data
  filter.type = parseInt(filter.type);
  const playPadding = 5.0; // time before and after filter points for good previewing

  // hand off to processor
  videoProcessor
    .preview([filter], playPadding, `-progress ${progressAddress}`)
    .then(() => {
      ffmpegProgressBar.close();
    })
    .catch((error) => {
      logger.error(error.message);
      ffmpegProgressBar.close();
      dialog.showMessageBox(mainWindow, {
        message: "Could not generate preview",
        type: "error",
        title: "Error",
        buttons: [],
      });
    });
}

// interface functions
ipcMain.on("button:click", function (e, buttonType) {
  switch (buttonType) {
    case "videoFile":
      handleVideoFileDialog();
      break;
    case "outputFile":
      handleOutputDialog();
      break;
    case "edlFile":
      handleEDLFileDialog();
      break;
    case "previewFile":
      handlePreviewFile();
      break;
    case "mergeFile":
      handleMergeFile();
      break;
    default:
      logger.error("unknown button");
      break;
  }
});

ipcMain.on("file:drop", function (e, filePath) {
  logger.debug(`dropped file: ${filePath}`);
  checkVideoFile(filePath);
});

ipcMain.on("preview:clip", function (e, filter) {
  logger.debug(`preview filter: ${JSON.stringify(filter)}`);
  handlePreviewFile(filter);
});
ipcMain.on("remuxMode", function (e, mode) {
  logger.info(`remux mode: ${mode}`);
  videoProcessor.remux_mode_enabled = mode;
  if (messageClient)
    messageClient("edlFilters:value", editDecisionList.filters);
});
