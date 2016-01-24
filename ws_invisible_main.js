function main() {

	//Script Globals

	//Keep original WebSocket object
	var BASE_WEBSOCKET = WebSocket;
	
	//Main WhosUp object
	var WhosUp = {
		//Misc. Regexes
		SEND_PRESENCE_REGEX: /\[\"Presence\"\,\s*\{\s*\"id\":["\d\w\.\,@]+\"type\"\s*:\s*\"(available)\"/g,
		PRESENCE_REGEX: /\[[\x22\x27]Presence[\x22\x27]\s*\,.*[\x22\x27]id[\x22\x27]\:/,
		PRESENCE_REGEX_LIGHT: '["Presence",{"id":',	//Simple string search to prevent heavy load
		INCOMING_PRESENCE_PREFIX_LENGTH: 12,

		//Deafult behaviors
		WS_SHOULD_DROP_AVAILABLE: true,
		WS_SHOULD_DROP_READ_RECEIPT: false,
		WS_SHOULD_DROP_RECEIVED: false,

		//Misc defaults
		WS_SHOULD_LOG: true,
		WS_SHOULD_RENEW_SUBSCRIPTIONS: false,		//Set if presences should be subscribed to every so and so seconds. Not generally necessary since subscriptions are (likely) permanent
		WS_PRESENCE_SUBSCRIBE_INTERVAL: 15000,		//Interval for presence subscription. Default = 2.5min
		WS_FIRST_PRESENCE_SUBSCRIBE_INTERVAL: 5000,	//Time to wait before subsribing after Store is created
		WS_STORE_CHECK_TIMEOUT: 2000,		//Time to sleep between attempts to find Store. Will be increased for each failed attempt
		WS_STORE_CHECK_TIMEOUT_FINE: 500,

		//Protocol metric values
 		WS_METRIC_PRESENCE: 8,
 		WS_METRIC_READ: 11,
 		WS_METRIC_RECEIVED: 13,

 		active_presences: {},

 		//Logger for debugging
		wsLog: function(str) {
			if (WhosUp.WS_SHOULD_LOG) {
				console.log("WS Log: " + str);
			}
		},

		subscribeAllPresences: function() {
			// return;	//TODO REMOVE
			
			var total_contacts = window.Store.Chat.models.length;
			var max_contacts = Math.min(total_contacts, 6);

			//TODO subscribe to all contacts or just chats
			// var max = window.Store.Contact.models.length;
			var contact, contact_id;
			var run_on_chat = true;	//TODO COMME IL FAUT
			for (var i=0; i<max_contacts; i++) {
				if (run_on_chat) {
					contact = window.Store.Chat.models[i].contact; //take contact from active chats
				}
				else {
					contact = window.Store.Contact.models[i];	//take contact from all contacts
				}
				if (!contact) continue;
				if (!contact.isUser || !contact.isWAContact) continue;	//Don't subscribe to groups or non-wa-users
				contact_id = contact.id;
				contact_name = contact.name;
				window.Store.Wap.presenceSubscribe(contact_id);
				WhosUp.wsLog("Subscribed to: " + contact_name);
			}
			WhosUp.wsLog("Subscribed all.");
		},

		//Wait for WA Web to create window.Store. When finally created, add interval call to subscribeAllPresences()
		waitForStoreTillSubscribe: function() {
			if (window.Store && window.Store.Chat && window.Store.Contact) {
				//window.Store is ready, call subscription interval
				WhosUp.wsLog("Store ready. Calling presenece subscriber.");
				window.setTimeout(WhosUp.subscribeAllPresences, WhosUp.WS_FIRST_PRESENCE_SUBSCRIBE_INTERVAL);	//Wait another 2 secs, then run presence subscriber for first time
				if (WhosUp.WS_SHOULD_RENEW_SUBSCRIPTIONS) {
					window.setInterval(WhosUp.subscribeAllPresences, WhosUp.WS_PRESENCE_SUBSCRIBE_INTERVAL);	//Then run presence subscriber every ~2 minutes					
					WhosUp.wsLog("Will renew subscriptions in " + WhosUp.WS_PRESENCE_SUBSCRIBE_INTERVAL + "ms.");
				}
			}
			else {
				//window.Store not ready yet, check again later			
				WhosUp.WS_STORE_CHECK_TIMEOUT += WhosUp.WS_STORE_CHECK_TIMEOUT_FINE;	//Increase timeout by 500ms for each failed attempt.
				window.setTimeout(WhosUp.waitForStoreTillSubscribe, WhosUp.WS_STORE_CHECK_TIMEOUT);
				WhosUp.wsLog("Store not ready yet. Checking again in " + WhosUp.WS_STORE_CHECK_TIMEOUT + "ms.");
			}
		},

		//returns presence json or null if not presence
		parsePresence: function(msg) {
			var n = msg.indexOf(WhosUp.PRESENCE_REGEX_LIGHT);
			if (n != -1) {	//found presence message
				WhosUp.wsLog("parsePresence: Found presence: " + msg);
				var presence_json_str = msg.substring(n + WhosUp.INCOMING_PRESENCE_PREFIX_LENGTH, msg.length - 1);
				var presence_json = JSON.parse(presence_json_str);
				if ("id" in presence_json && "type" in presence_json)
					return presence_json;
			}
			return null;	//nothing to return if no id or availability found in message
		},

		handleIncomingPresence: function(presence_json) {
			if (!presence_json) return null;
			if ("id" in presence_json && "type" in presence_json) {
				var presence_contact, contact_name, contact_id, presence_type;
				presence_contact = window.Store.Contact._find(presence_json.id);
				contact_id = presence_json.id;
				contact_name = presence_contact.name;
				presence_type = presence_json.type;
				if (presence_type == "available")
				{
					WhosUp.wsLog(contact_name + " is " + presence_type);
					if (!contact_id in WhosUp.active_presences) {
						WhosUp.active_presences.contact_id = presence_contact;
					}
					
					//TODO:
					//ADD TO ALL_PRESENCES IF NOT ALREADY THERE
					//UPDATE DISPLAY
				}
				if (presence_type == "unavailable") {
					// WhosUp.wsLog(contact_name + " is " + presence_type);
					if (contact_id in WhosUp.active_presences) {
						delete WhosUp.active_presences.contact_id;
					}
					//TODO:
					//CHECK IF IN TABLE
					//IF YES, REMOVE FROM ALL_PRESENCES
					//UPDATE DISPLAY
				}
			}
		},

		//Replaces WebSocket receive() with own function to parse incoming messages
		hijackSocketReceive: function(ws) {
			if (typeof ws.captured == 'undefined') {	//Verify listener not already added
				WhosUp.wsLog('hijackSocketReceive: hijacking receive');
				ws.addEventListener('message', function(e) {
					var event = {
						event: 'websocket_recv',
			            from: location,
			            data: e.data,
			            url: e.target.URL
			        };
					var str = event.data;
					if (typeof str != "string") return;	//Incoming binary message. can't handle
					var presence_json = WhosUp.parsePresence(str);
					WhosUp.handleIncomingPresence(presence_json);
				});
				ws.captured = true;
			}
		},

		//Wraps WebSocket.Send(): drops "Available" message and sends all others using original Send()
		hijacked_send_no_online: function() {
			data = arguments[0];

			if (typeof data != "string") {	//Data is binary message. May be presence or read receipt
				WhosUp.wsLog("Sending binary message");
				var buf = data;
				dataUint8 = new Uint8Array(data);

				var dataStr = String.fromCharCode.apply(null, dataUint8);
				// WhosUp.wsLog("data: " + dataStr);
				var n = dataStr.search(/,/g);	
				if (n != -1) {
					// WhosUp.wsLog("Found comma at index: " + n + ", data length is " + dataUint8.length);

					var metric = dataUint8[n+1];
					var n = dataUint8[n+2];

					var is_available = (n >> 5) & 0x1;
					if (is_available === 0x1) {
						WhosUp.wsLog("Caught AVAILABLE message from client.");
						if (WhosUp.WS_SHOULD_DROP_AVAILABLE) {
							WhosUp.wsLog("Dropping Available message.");
							return;
						}
						else {
							WhosUp.wsLog("Letting Available message pass.");
						}
					}
					var is_unavailable = (n >> 4) & 0x1;
					if (is_unavailable === 0x1) {
						WhosUp.wsLog("Caught UNAVAILABLE message");
					}
					if (metric == WhosUp.WS_METRIC_READ) {
						WhosUp.wsLog("Caught READ metric from client.");
						if (WhosUp.WS_SHOULD_DROP_READ_RECEIPT) {
							WhosUp.wsLog("Dropping Read receipt.");
							return;
						}
						else {
							WhosUp.wsLog("Letting Read receipt pass.");
						}
					}
					if (metric == WhosUp.WS_METRIC_RECEIVED) {
						WhosUp.wsLog("Caught RECEIVED message from client.");
						if (WhosUp.WS_SHOULD_DROP_RECEIVED) {
							WhosUp.wsLog("Dropping Received message.");
							return;
						}
						else {
							WhosUp.wsLog("Letting Received message pass.");
						}
					}
				}
			}
			return BASE_WEBSOCKET.prototype.send.apply(this,arguments);	//If not dropped, send message using regular WebSocket.Send()

		},	//End hijacked_send_no_online

		hijackSocketSend: function(ws) {
			//Override WebSocket send function with own
			ws.send = WebSocket.prototype.send = WhosUp.hijacked_send_no_online;
		}

	};	//End WhosUp class object

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
				var n = str.indexOf(WhosUp.PRESENCE_REGEX_LIGHT);	
				var presence_json, presence_json_str, presence_contact, presence_name, presence_type;
				if (n != -1) {	//found presence message
					presence_json_str = str.substring(n + WhosUp.INCOMING_PRESENCE_PREFIX_LENGTH, str.length - 1);
					presence_json = JSON.parse(presence_json_str);
					if ("id" in presence_json && "type" in presence_json) {
						presence_contact = window.Store.Contact._find(presence_json.id);
						contact_name = presence_contact.name;
						presence_type = presence_json.type;
						if (presence_type == "available")
							WhosUp.wsLog(contact_name + " is " + presence_type);
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
				var n = str.search(WhosUp.PRESENCE_REGEX);
				if (n != -1) {
					var presence_json_str = str.substring(n + 12, str.length - 1);
					var presence_json = JSON.parse(presence_json_str);
					WhosUp.wsLog("Presence JSON: " + JSON.stringify(presence_json));
				}
			});
			ws.captured = true;
		}
	}

	//Wrapper for WebSocket.send()
	//TODO REMOVE
	var hijacked_send = function() {
		data = arguments[0];
		console.trace("Send trace");
		if (typeof data == "string") {
			console.log("Sent: " + data);
			//TODO what here?
		}
		return BASE_WEBSOCKET.prototype.send.apply(this,arguments);
	}


	//Hijack WebSocket object
	WebSocket = function(a, b) {
		var base;
		//Call base constructor with whether 1 or 2 args
		base = (typeof b !== "undefined") ? new BASE_WEBSOCKET(a, b) : new BASE_WEBSOCKET(a);
		//Add message receive event to WebSocket
		WhosUp.hijackSocketReceive(base);
		//Override WebSocket Send() with own
		WhosUp.hijackSocketSend(base);
		return base;
	};

	//COMMENTED-OUT BECAUSE BLOCKED. TODO UNCOMMENT SEE IF BLOCK REMOVED
	WhosUp.waitForStoreTillSubscribe(); 			//Wait till window.Store is ready, then start subscribing to 
	
}

// Inject hijacking functions to DOM
var script = document.createElement('script');
script.appendChild(document.createTextNode('(' + main + ')();'));
(document.body || document.head || document.documentElement).appendChild(script);