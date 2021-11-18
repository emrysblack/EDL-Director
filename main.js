const {app, BrowserWindow, Menu, dialog, ipcMain} = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const child_process = require('child_process');
const ffbinaries = require('ffbinaries');
const ProgressBar = require('electron-progressbar');
const http = require('http');
const winston = require('winston');
const ini = require('ini'); // TODO, implement user settings with defaults and restore functions

const logConfiguration = {
    transports: [
        new winston.transports.File({
            level: 'debug',
			maxsize: 3000000,
			maxFiles: 1,
			tailable: true,
            filename: 'logs/main.log',
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json()
			)
        })
    ]
};
const logger = winston.createLogger(logConfiguration);

logger.debug("starting program");

const srv = http.createServer(function(req, res) {
	let progressBar = null;
	const setupProgressBar = () => {
		logger.info(`Saving file ${path.join(outputDir, outputFile)}`);
		progressBar = new ProgressBar({
			indeterminate: false,
			title: 'Saving Video',
			text: `Saving ${outputFile.substring(outputFile.lastIndexOf(path.sep) + 1)}...`,
			detail: 'Processing all filters...',
			maxValue: (parseFloat(videoFileDuration) - cutsLength) * 1000000, // convert to microseconds
			closeOnComplete: false,
			browserWindow: {frame: false, icon: icon, parent:mainWindow}
		});
		progressBar.on("progress", function(value){
			const maxValue = progressBar.getOptions().maxValue;
			const displayProgress = `${parseInt((value / maxValue) * 100)}%`;
			logger.debug(displayProgress);
			progressBar.text = progressBar.text.substring(0, progressBar.text.indexOf("...")) + `...${displayProgress}`;
		});
	};
	const updatePercent = data => {
		if(!progressBar){ setupProgressBar(); }
		progressBar.value = data;
	}
	req.on("data", (chunk) => {
		// convert input to Object
		const data = Object.fromEntries(chunk.toString().split('\n').filter(entry=>entry.length).map(entry=>entry.split("=")));
		const elapsed = parseFloat(data["out_time_us"]); // microseconds
		updatePercent(elapsed);
	});
	req.on("end", () => {
		progressBar.setCompleted();
		setTimeout(function(){ // don't disappear immediately for user benefit
			progressBar.close();
			dialog.showMessageBox(mainWindow,{
				message: "File Saved Successfully",
				type:"none",
				icon: icon,
				title:"EDL Director",
				buttons:[]
			});
		}, 1500);
		logger.info("done");
		res.writeHead(200);
		res.end("OK");
	});
});
srv.listen(0, "127.0.0.1", function() {
  logger.debug('Listening for FFMpeg on: ' + srv.address().address + ":" + srv.address().port);
});

const ffbinariesList = ['ffmpeg', 'ffplay', 'ffprobe'];
const binLocation = path.join(__dirname, 'bin');
const icon = path.join(__dirname, 'icon.png');
let ffBin = null;

let mainWindow;
let messageClient = null;
// listen for app to be ready
function createWindow(){
	mainWindow = new BrowserWindow({icon: icon,show:false, webPreferences:{
      preload: path.join(__dirname,'preload.js'),
	  //nodeIntegration: false,
    }});
	
	mainWindow.loadFile("mainWindow.html");
	// init menu
	const mainMenu = Menu.buildFromTemplate(menuTemplate);
	Menu.setApplicationMenu(mainMenu);
	
	// setup messaging
	mainWindow.webContents.on('did-finish-load', ()=>{
		messageClient = function(channel, value) { mainWindow.webContents.send(channel, value); }
	});
	
	// show when ready
	mainWindow.once('ready-to-show', () => {
	  mainWindow.show()
	});
};

const menuTemplate = [{
		label: "File",
		submenu: [
		{
			label:"Open Video File",
			click(){
				handleVideoFileDialog();
			}
		},
		{
			label:"Open EDL File",
			click(){
				handleEDLFileDialog();
			}
		},
		{
			accelerator: process.platform !== 'darwin' ? 'Ctrl+Q' : 'Command+Q',
			label: "Exit",
			click(){
				app.quit();
			}
		}]
}];

app.whenReady().then(() => {
	// first run setup
	const downloads = [];
	let progressBar = null;
	const setupProgressBar = () => {
		logger.info("downlading missing dependencies");
		progressBar = new ProgressBar({
			indeterminate: false,
			title: 'EDL Director',
			text: 'Initializing...',
			detail: 'updating binaries...',
			maxValue: 1,
			browserWindow: {frame: false, icon: icon}
		});
	};
	const updatePercent = data => {
		if(!progressBar){ setupProgressBar(); }
		const { filename, progress } = data;
		downloads[filename] = progress;
		const totalPercent = Object.values(downloads).reduce((total, download)=> total + download, 0) / Object.values(downloads).length;
		logger.debug(`${parseInt(totalPercent * 100)}%`);
		progressBar.value = totalPercent;
	}
	
	ffbinaries.downloadBinaries(ffbinariesList,{ destination: binLocation, tickerFn: updatePercent },function (err, data) {

	  if (progressBar) { progressBar.setCompleted(); }
	  
	  if(err) {
		dialog.showErrorBox('Binaries error', err);
		logger.error(JSON.stringify(err));
		app.exit(1);
	  }
	  // everything is ready, start program
	  ffBin = ffbinaries.locateBinariesSync(ffbinariesList, {paths:[binLocation], ensureExecutable: true});
	  logger.info(`binaries: ${JSON.stringify(ffBin)}`);
	  createWindow();
	});

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// Mac OS menu fix
if (process.platform == 'darwin') {
	menuTemplate.unshift({});
}

// if not live, use dev tools
if(process.env.NODE_ENV != 'production') {
	menuTemplate.push({
		label: "Developer Tools",
		submenu: [{
			label: "Toggle DevTools",
			click(item, focusedWindow) {
				focusedWindow.toggleDevTools();
			}
		}]
	});
}
let videoFile = '';
let outputDir = '';
let outputFile = '';
let videoFileDuration = 0;
let cutsLength = 0;
let edlFile = '';

const filters = [];

const videoFileTypes = ['mp4','m4v','mkv','mov','mpg','mpeg','avi','wmv','flv','webm'];

function checkEdlValues(start, end, mute) {
	a = parseFloat(start);
	b = parseFloat(end);
	c = parseInt(mute);
	
	return !isNaN(a) && !isNaN(b) && !isNaN(c) && a < b && !(c >> 1) // 0 or 1
}

function parseEdlLine(line) {
	const re = /\s/;
	const values = line.split(re);
	const passed = checkEdlValues(...values);
	if(passed) {
		filters.push({start:values[0],end:values[1],type:parseInt(values[2])});
	}
	return passed;
}

async function parseEdlFile() {
	if(!edlFile){return;}
	filters.length = 0;
	const fileStream = fs.createReadStream(edlFile);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  // Note: we use the crlfDelay option to recognize all instances of CR LF
  // ('\r\n') in input.txt as a single line break.

  for await (const line of rl) {
    // Each line in input.txt will be successively available here as `line`.

	if(!parseEdlLine(line.trim())){
		// clear edl and report
		filters.length = 0;
		messageClient('edlText:value', 'Invalid EDL File');
		break;
	}
  }
  
  // send filters
  messageClient('edlFilters:value', filters);
  
}

function checkEdlFile() {
	const file = videoFile.substring(0, videoFile.lastIndexOf(".")) + ".edl";
	// Check if the file exists
	fs.access(file, fs.constants.F_OK, (err) => {
		edlFile = err ? '' : file;
		parseEdlFile();
		messageClient('edlText:value', edlFile);
		logger.debug(`${file} ${err ? 'does not exist' : 'exists'}`);
	});
}

function checkVideoFile(file) {
	logger.debug(`check file: ${file}`);
	const command = `"${ffBin.ffprobe.path}" -v quiet -show_error -print_format json -show_format "${file}"`;
	logger.debug(command);
	var child = child_process.exec(command, (error, stdout, stderr) => {
		const result = JSON.parse(stdout);
		// invalid read
		if(result.error !== undefined || result.format.duration === undefined) {
			dialog.showMessageBox(mainWindow,{
				message: "Not a Supported Video File",
				type:"error",
				title:"Error",
				buttons:[]
			});
			logger.error(`Could not parse video ${file}`);
			return;
		}
		// everything ok
		videoFile = file;
		const filename = file.substring(videoFile.lastIndexOf(path.sep) + 1);
		const ext = filename.substring(filename.lastIndexOf("."));
		outputFile = `${filename.substring(0, filename.lastIndexOf("."))}_merged${ext}`;
		if (!outputDir.length) {
			outputDir = file.substring(0, videoFile.lastIndexOf(path.sep));
		}
		videoFileDuration = result.format.duration;
		logger.debug(`duration: ${videoFileDuration}`);
		messageClient('videoText:value', videoFile);
		messageClient('outputText:value', path.join(outputDir, outputFile));
		checkEdlFile();
	});
}

async function handleVideoFileDialog() {
	const file = await dialog.showOpenDialog({
					filters:[{
						name: 'Videos',
						extensions: videoFileTypes,
					}].concat(videoFileTypes.map(type=>({name:type,extensions:[type]}))),
					properties:['openFile']
				});

	if (!file.canceled) { logger.debug(`video selected: ${file.filePaths[0]}`);
		checkVideoFile(file.filePaths[0]);
	}
}

async function handleOutputDirDialog() {
	const file = await dialog.showOpenDialog({
					properties:['openDirectory']
				});

	if (!file.canceled) { logger.debug(`output dir selected: ${file.filePaths[0]}`);
		outputDir = file.filePaths[0];
		messageClient('outputText:value', path.join(outputDir, outputFile));
	}
}

async function handleEDLFileDialog() {
	const file = await dialog.showOpenDialog({
					filters:[{
						name: 'EDL files',
						extensions:['edl','txt']
					}],
					properties:['openFile']
				});

	if (!file.canceled) {
		logger.debug(`edl selected: ${file.filePaths[0]}`);
		edlFile = file.filePaths[0];
		parseEdlFile();
		messageClient('edlText:value', edlFile);
	}
}

formatCuts = cuts => (cuts.map(edit=>`not(between(t,${edit.start},${edit.end}))`).join("*"));
formatMutes = mutes => (mutes.map(edit=>`between(t,${edit.start},${edit.end})`).join("+"));

async function handleFile(ff, edits, options) {
	// options
	const opts = {ss:"",t:"",output:"",title:"",progress:"", ...options};
	
	const audioArgs = [];
	
	// process filters
	const cuts = formatCuts(edits.filter(edit=>!edit.type));
	const mutes = formatMutes(edits.filter(edit=>edit.type));
	
	cutsLength = edits.filter(edit=>!edit.type).reduce(function(total, cut){return total + (cut.end - cut.start)},0);
	logger.debug(`cut time from video: ${cutsLength}`);
	
	if(mutes.length){
		audioArgs.push(`volume=enable='${mutes}':volume=0`);
	}
	if(cuts.length) {
		audioArgs.push(`aselect='${cuts}',asetpts=N/SR/TB`);
	}
	const videoFilter = cuts.length ? `-vf "select='${cuts}',setpts=N/FRAME_RATE/TB"` : '-c:v copy';
	const audioFilter = `-af "${audioArgs.join(',')}"`;
	const command = `"${ff}" ${opts.title} ${opts.progress} -i "${videoFile}" ${videoFilter} ${audioFilter} ${opts.ss} ${opts.t} ${opts.output}`.trim();
	logger.debug(command);
	var child = child_process.exec(command);
}

function handleMergeFile() {
	handleFile(ffBin.ffmpeg.path, filters, {output:`"${path.join(outputDir, outputFile)}"`,progress:`-y -progress http://${srv.address().address}:${srv.address().port}/`});
}

function handlePreviewFile(filter) {
	// ready data
	filter.type = parseInt(filter.type);
	const playPadding = 5.0; // time before and after filter points for good previewing
	const ss = parseFloat(filter.start) > playPadding ? parseFloat(filter.start) - playPadding : 0;
	const t = parseFloat(filter.end) + playPadding - ss;
	// hand off to processor
	handleFile(ffBin.ffplay.path, filters, {ss:`-ss ${ss}`,t:`-t ${t}`, title:'-window_title "Filter Preview"'});
}

// interface functions
ipcMain.on('button:click', function(e, buttonType){
	switch(buttonType) {
		case "videoFile":
			handleVideoFileDialog();
			break;
		case "outputDir":
			handleOutputDirDialog();
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

ipcMain.on('file:drop', function(e, filePath){ logger.debug(`dropped file: ${filePath}`);
	checkVideoFile(filePath);
});

ipcMain.on('preview:clip', function(e, filter){
	logger.debug(`preview filter: ${JSON.stringify(filter)}`);
	handlePreviewFile(filter);
});