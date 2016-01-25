function save_options() {
	for (o in WS_DROP_OPTIONS) {
		WS_DROP_OPTIONS[o] = document.getElementById(o).checked;
	}
	chrome.storage.sync.set(WS_DROP_OPTIONS);
}

function restore_options() {
  chrome.storage.sync.get(WS_DROP_OPTIONS, function(opts) {
  	if (!"drop_available" in opts) opts = WS_DROP_OPTIONS;
  	for (o in WS_DROP_OPTIONS) {
  		document.getElementById(o).checked = opts[o];
  	}
  });
}

document.addEventListener('DOMContentLoaded', function(){
	for (o in WS_DROP_OPTIONS) {
		document.getElementById(o).onclick = save_options;
	}
	restore_options();
});