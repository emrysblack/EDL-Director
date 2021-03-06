const { send, receive, once } = ipcRenderer;

// outgoing events
document.querySelector("form").addEventListener("submit", function (e) {
  e.preventDefault();
});
document.getElementById("outputButton").addEventListener("click", function (e) {
  e.preventDefault();
  send("button:click", "outputFile");
});
document.getElementById("edlButton").addEventListener("click", function (e) {
  e.preventDefault();
  send("button:click", "edlFile");
});
document.getElementById("mergeButton").addEventListener("click", function (e) {
  e.preventDefault();
  send("button:click", "mergeFile");
});
document.getElementById("remuxMode").addEventListener("change", function (e) {
  e.preventDefault();
  document
    .getElementById("edl-filters-table")
    .classList.toggle("remux", this.checked);
  send("remuxMode", this.checked);
});

// incoming events
once("remuxMode:init", function (val) {
  document.getElementById("remuxMode").checked = val;
  document.getElementById("edl-filters-table").classList.toggle("remux", val);
});
receive("remuxMode:available", function (val) {
  document.getElementById("remuxModeSection").classList.toggle("hidden", !val);
});
receive("videoText:value", function (val) {
  const valid = val.length;
  document.getElementById("videoText").innerText = val;
  document.getElementById("vidFileDragDrop").classList.toggle("hidden", valid);
  document.getElementById("mainArea").classList.toggle("hidden", !valid);
});
receive("outputText:value", function (val) {
  document.getElementById("outputText").value = val;
});
receive("edlText:value", function (val) {
  const valid = val.length;
  document.getElementById("edlText").value = val;
  document.getElementById("edl-filters").classList.toggle("hidden", !valid);
});
receive("edlFilters:value", function (vals) {
  const table = document.querySelector("#edl-filters-table tbody");
  table.innerHTML = "";

  vals.forEach(function (val) {
    console.log(val);
    table.append(document.querySelector(".filter-row").content.cloneNode(true));
    const rows = document.querySelectorAll("#edl-filters-table tbody tr");
    const row = rows[rows.length - 1];
    console.log(row);

    row.dataset.start = val.start;
    row.dataset.end = val.end;
    row.dataset.type = val.type;
    if (val.startKeyFrame) row.dataset.startkeyframe = val.startKeyFrame;
    if (val.endKeyFrame) row.dataset.endkeyframe = val.endKeyFrame;
    row.querySelector(".filter-start").innerHTML = val.startKeyFrame
      ? `<span class="keyframe">${val.startKeyFrame}</span><span class="frame">${val.start}</span>`
      : val.start;
    row.querySelector(".filter-end").innerHTML = val.endKeyFrame
      ? `<span class="keyframe">${val.endKeyFrame}</span><span class="frame">${val.end}</span>`
      : val.end;
    row.querySelector(".filter-type").innerText = val.type ? "Mute" : "Cut";
    row.querySelector(".previewButton").onclick = previewFilter;
  });
});

// handle table buttons
function previewFilter() {
  const row = this.parentElement.parentElement; // grandparent
  const start = row.dataset.start;
  const end = row.dataset.end;
  const type = parseInt(row.dataset.type);
  const startKeyFrame = row.dataset.startkeyframe;
  const endKeyFrame = row.dataset.endkeyframe;

  send("preview:clip", {
    start,
    end,
    type,
    ...(startKeyFrame && { startKeyFrame }),
    ...(endKeyFrame && { endKeyFrame }),
  });
}
const vidFileDragDrop = document.getElementById("vidFileDragDrop");
vidFileDragDrop.addEventListener("click", function (e) {
  e.preventDefault();
  send("button:click", "videoFile");
});
vidFileDragDrop.addEventListener("dragover", function (e) {
  e.preventDefault();
});
vidFileDragDrop.addEventListener("drop", function (e) {
  e.preventDefault();
  // only allow single file
  const file =
    e.dataTransfer.files.length == 1 ? e.dataTransfer.files[0] : null;
  console.log("file", file);
  if (file) {
    send("file:drop", file.path);
  }
});
