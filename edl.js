const fs = require("fs");
const readline = require("readline");

class Filter {
  static Types = { CUT: 0, MUTE: 1 };
  constructor(start, end, type) {
    this.start = start.toString();
    this.end = end.toString();
    this.type = parseInt(type);
  }
  static checkEdlValues(start, end, mute) {
    const a = parseFloat(start);
    const b = parseFloat(end);
    const c = parseInt(mute);

    return !isNaN(a) && !isNaN(b) && !isNaN(c) && a < b && !(c >> 1); // 0 or 1
  }
}

class EDLFileParser {
  static parseEdlLine(line) {
    const re = /\s/;
    const values = line.split(re);
    if (!Filter.checkEdlValues(...values)) {
      throw "Invalid EDL File";
    }

    return values;
  }

  static async parse(edlFile) {
    if (!edlFile) {
      throw "No file specified";
    }

    const filters = [];
    const fileStream = fs.createReadStream(edlFile);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    // Note: we use the crlfDelay option to recognize all instances of CR LF
    // ('\r\n') in input.txt as a single line break.
    // ignore comments and empty lines
    for await (const line of rl) {
      if (line.trim().length && line.trim()[0] != "#") {
        filters.push(new Filter(...EDLFileParser.parseEdlLine(line.trim())));
      }
    }
    return filters;
  }
}

class EditDecisionList {
  filters = [];
  async load(filePath) {
    this.filters = await EDLFileParser.parse(filePath);
  }
  clear() {
    this.filters.length = 0;
  }
}

module.exports = EditDecisionList;
exports = module.exports;
exports.Filter = Filter;
