//Main function that will be injected to the DOM to override the Web client functionalities
function main_hijack() {

	//Injected script globals
	//--------------

	//Keep copy of original WebSocket object
	var BASE_WEBSOCKET = WebSocket;
	
	//Main extension object
	var WhatsHide = {

		//Misc. Regexes
		SEND_PRESENCE_REGEX: /\[\"Presence\"\,\s*\{\s*\"id\":["\d\w\.\,@]+\"type\"\s*:\s*\"(available)\"/g,
		PRESENCE_REGEX: /\[[\x22\x27]Presence[\x22\x27]\s*\,.*[\x22\x27]id[\x22\x27]\:/,
		PRESENCE_REGEX_LIGHT: '["Presence",{"id":',	//Simple string search to prevent heavy load
		INCOMING_PRESENCE_PREFIX_LENGTH: 12,

		//Misc defaults for future features
		WS_SHOULD_LOG: false,
		WS_SHOULD_RENEW_SUBSCRIPTIONS: false,		//Set if presences should be subscribed to every so and so seconds. Not generally necessary since subscriptions are (likely) permanent
		WS_PRESENCE_SUBSCRIBE_INTERVAL: 15000,		//Interval for presence subscription. Default = 2.5min
		WS_FIRST_PRESENCE_SUBSCRIBE_INTERVAL: 5000,	//Time to wait before subsribing after Store is created
		WS_STORE_CHECK_TIMEOUT: 2000,		//Time to sleep between attempts to find Store. Will be increased for each failed attempt
		WS_STORE_CHECK_TIMEOUT_FINE: 500,

		//Protocol metric constants
 		WS_METRIC_PRESENCE: 8,
 		WS_METRIC_READ: 11,
 		WS_METRIC_RECEIVED: 13,
 		WS_PRESENCE_BITVECTOR_AVAILABLE_OFFSET: 5,
 		WS_PRESENCE_BITVECTOR_UNAVAILABLE_OFFSET: 4,


 		//Logger for debugging
		wsLog: function(str) {
			if (WhatsHide.WS_SHOULD_LOG) {
				console.log("WS Log: " + str);
			}
		},

		//Wraps WebSocket.Send(): drops "Available" messages, lets all others pass using original Send()
		hijacked_send_no_online: function() {
			data = arguments[0];

			if (typeof data != "string") {	//Data is binary message. Might be a presence or read-receipt.
				WhatsHide.wsLog("Sending binary message");
				var buf = data;
				dataUint8 = new Uint8Array(data);

				var dataStr = String.fromCharCode.apply(null, dataUint8);
				var n = dataStr.search(/,/g);	
				if (n != -1) {	//check if outgoing message has any payload
					var metric = dataUint8[n+1];	//represents WA's code for each type of message
					var bitvector_byte = dataUint8[n+2];
					var is_available = (bitvector_byte >> WhatsHide.WS_PRESENCE_BITVECTOR_AVAILABLE_OFFSET) & 0x1;
					if (is_available === 1) {
						WhatsHide.wsLog("Caught Available message from client.");

						if (WS_DROP_OPTIONS[WS_DROP_AVAILABLE]) {
							WhatsHide.wsLog("Dropping Available message.");
							return;
						}
						else {
							WhatsHide.wsLog("Letting Available message pass.");
						}
					}
					var is_unavailable = (bitvector_byte >> WhatsHide.WS_PRESENCE_BITVECTOR_UNAVAILABLE_OFFSET) & 0x1;
					if (is_unavailable === 1) {
						WhatsHide.wsLog("Caught Unavailable message from client.");
					}
					if (metric == WhatsHide.WS_METRIC_READ) {
						WhatsHide.wsLog("Caught Read metric from client.");
						if (WS_DROP_OPTIONS[WS_DROP_READ_RECEIPT]) {
							WhatsHide.wsLog("Dropping Read receipt.");
							return;
						}
						else {
							WhatsHide.wsLog("Letting Read receipt pass.");
						}
					}
					if (metric == WhatsHide.WS_METRIC_RECEIVED) {
						WhatsHide.wsLog("Caught Received message from client.");
						if (WS_DROP_OPTIONS[WS_DROP_RECEIVED]) {
							WhatsHide.wsLog("Dropping Received message.");
							return;
						}
						else {
							WhatsHide.wsLog("Letting Received message pass.");
						}
					}
				}
			}
			return BASE_WEBSOCKET.prototype.send.apply(this,arguments);	//If not dropped, send message using regular WebSocket.Send()
		},	//end hijacked_send_no_online

		//Override WebSocket Send() with own
		hijackSocketSend: function(ws) {
			ws.send = WebSocket.prototype.send = WhatsHide.hijacked_send_no_online;
		},

		//Returns presence json or null if message is not presence
		parsePresence: function(msg) {
			var n = msg.indexOf(WhatsHide.PRESENCE_REGEX_LIGHT);
			if (n != -1) {	//found presence message
				WhatsHide.wsLog("parsePresence: Found presence: " + msg);
				var presence_json_str = msg.substring(n + WhatsHide.INCOMING_PRESENCE_PREFIX_LENGTH, msg.length - 1);
				var presence_json = JSON.parse(presence_json_str);
				if ("id" in presence_json && "type" in presence_json)
					return presence_json;
			}
			return null;	//nothing to return if no id or availability found in message
		},

	};	//End class object

	function hijackedReceive(ws) {
		if (typeof ws.captured == 'undefined') {	//Verify listener not already added
			ws.addEventListener('message', function(e) {
				var event = {
					event: 'websocket_recv',
		            from: location,
		            data: e.data,
		            url: e.target.URL
		        };
				var str = event.data;
				if (typeof str != "string") return;	//incoming binary message. doesn't concern us
				var n = str.indexOf(WhatsHide.PRESENCE_REGEX_LIGHT);
				var presence_json, presence_json_str, presence_contact, presence_name, presence_type;
				if (n != -1) {	//found presence message
					presence_json_str = str.substring(n + WhatsHide.INCOMING_PRESENCE_PREFIX_LENGTH, str.length - 1);
					presence_json = JSON.parse(presence_json_str);
					if ("id" in presence_json && "type" in presence_json) {
						presence_contact = window.Store.Contact._find(presence_json.id);
						contact_name = presence_contact.name;
						presence_type = presence_json.type;
						if (presence_type == "available")
							WhatsHide.wsLog(contact_name + " is " + presence_type);
					}
				}
			});
			ws.captured = true;
		}		
	}

	//Adds event listener for incoming messages on WebSocket
	function wrapReceive(ws) {
		if (typeof ws.captured == 'undefined') {	//verify listener not already added
			ws.addEventListener('message', function(e) {
				var event = {
					event: 'websocket_recv',
		            from: location,
		            data: e.data,
		            url: e.target.URL
		        };
				var str = event.data;
				if (typeof str != "string") return;
				var n = str.search(WhatsHide.PRESENCE_REGEX);
				if (n != -1) {
					var presence_json_str = str.substring(n + 12, str.length - 1);
					var presence_json = JSON.parse(presence_json_str);
					WhatsHide.wsLog("Presence JSON: " + JSON.stringify(presence_json));
				}
			});
			ws.captured = true;
		}
	}

	//Hijack WebSocket object
	WebSocket = function(a, b) {
		WhatsHide.wsLog("Creating new WebSocket().");
		var base;
		//Call base constructor with 1 or 2 args
		base = (typeof b !== "undefined") ? new BASE_WEBSOCKET(a, b) : new BASE_WEBSOCKET(a);
		//Override WebSocket Send() with own
		WhatsHide.hijackSocketSend(base);
		WhatsHide.wsLog("Hijacked WebSocket.Send() with own");
		return base;
	};
	 	
}	//end main_hijack()


//Retrieve settings from storage or set to defaults
function get_settings() {
  chrome.storage.sync.get(WS_DROP_OPTIONS, function(opts) {
  		for (o in WS_DROP_OPTIONS) {	//verify all options available in storage or set to defaults
  			if (!o in opts) {
  				return;
  			}
  		}
  		WS_DROP_OPTIONS = opts;
  		var commons_injected_script = document.createElement('script');
		var inj_str = 'var WS_DROP_AVAILABLE = "drop_available"; var WS_DROP_READ_RECEIPT = "drop_read_receipt"; var WS_DROP_RECEIVED = "drop_received";';
		inj_str += 'var WS_DROP_OPTIONS = ' + JSON.stringify(WS_DROP_OPTIONS) + ';';
		commons_injected_script.appendChild(document.createTextNode(inj_str));
		(document.body || document.head || document.documentElement).appendChild(commons_injected_script);
  });
}

//Get settings from Storage and inject them to DOM
get_settings();

//Inject hijacking script to DOM
var main_injected_script = document.createElement('script');
main_injected_script.appendChild(document.createTextNode('(' + main_hijack + ')();'));
(document.body || document.head || document.documentElement).appendChild(main_injected_script);