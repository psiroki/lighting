var room = [{displayName:"Bedroom",luxIntensity:[100,150,250]},{displayName:"Drawing room",luxIntensity:[100,150,200]},{displayName:"Kitchen",luxIntensity:[150,200,300]},{displayName:"Passage/lobby",luxIntensity:[50,100,150]},{displayName:"Balcony/Stairs",luxIntensity:[50,100,150]},{displayName:"Conference",luxIntensity:[200,300,500]},{displayName:"Pantry",luxIntensity:[100,150,200]},{displayName:"Office",luxIntensity:[150,250,350]},{displayName:"Party hall",luxIntensity:[400,500,700]},{displayName:"Waiting",luxIntensity:[50,75,100]},{displayName:"Warehouse",luxIntensity:[100,150,200]},{displayName:"Classroom",luxIntensity:[150,250,350]},{displayName:"Supermarket",luxIntensity:[600,750,1000]},{displayName:"Shops",luxIntensity:[200,300,400]},{displayName:"Showroom",luxIntensity:[400,700,1500]},{displayName:"Restaurant",luxIntensity:[100,200,500]},{displayName:"Hospital",luxIntensity:[200,400,800]},{displayName:"Library",luxIntensity:[200,300,400]}];

var intensityNames = [ "[] low ({})", "[] medium ({})", "[] high ({})" ];

var intensity = document.getElementsByTagName("select").item(0);
var dimensions = Array.from(document.querySelectorAll("input[type=number]"));
var output = document.querySelector(".output");
var result = document.querySelector(".result");
var detach = document.querySelector(".detach");
var searchInput = document.querySelector("input[type=search]");
var script = document.querySelector("script");

room.forEach(e => {
	var grp = document.createElement("optgroup");
	grp.label = e.displayName;
	e.luxIntensity.forEach((i, j) => {
		var opt = document.createElement("option");
		opt.value = i;
		opt.textContent = intensityNames[j]
			.replace(/\{\}/g, i.toLocaleString())
			.replace(/\[\]/g, e.displayName);
		grp.appendChild(opt);
	});
	intensity.appendChild(grp);
});

var currentItem = null;

function stepLastCodePoint(s) {
	var l;
	var fin = s.charCodeAt(s.length-1);
	if(fin >= 0xdc00 && fin < 0xe000) {
		// part of a surrogate pair
		l = 2;
	} else {
		l = 1;
	}
	var prefix = s.length-l;
	return s.substring(0, prefix)+String.fromCodePoint(s.codePointAt(prefix)+1);
}

function prefixRange(prefix) {
	return IDBKeyRange.bound(prefix, stepLastCodePoint(prefix), false, true);
}

function DatabaseConnection(kinds) {
	this.storeQueue = [ ];
	this.pendingCalls = [ ];
	this.openRequest = indexedDB.open("Lighting", 6);
	this.openRequest.onerror = function(event) {
		console.log("Database access is disabled");
		this.storeQueue = null;
		this.openRequest = null;
	}.bind(this);
	this.openRequest.onsuccess = function(event) {
		this.db = event.target.result;
		var queue = this.storeQueue;
		this.storeQueue = null;
		var calls = this.pendingCalls;
		this.pendingCalls = null;
		this.storeParcels(queue);
		for(var call of calls)
			call();
		this.openRequest = null;
	}.bind(this);
	this.openRequest.onupgradeneeded = function(event) {
		this.db = event.target.result;
		for(var kind of kinds) {
			if(typeof kind === "string")
				kind = { name: kind };
			var store;
			try {
				store = event.target.transaction.objectStore(kind.name);
			} catch(e) {
				store = this.db.createObjectStore(kind.name, { keyPath: "key" });
			}
			if(kind.indexes) {
				if(!(kind.indexes instanceof Array))
					kind.indexes = [ kind.indexes ];
				for(var indexKeyPath of kind.indexes) {
					try {
						store.createIndex(indexKeyPath.replace(/\./g, "_"), indexKeyPath, { unique: false });
					} catch(e) {
						console.warn(e);
					}
				}
			}
		}
	}.bind(this);
}

DatabaseConnection.prototype = {
	store(kind, value) {
		var parcel = { kind: kind, value: value };
		if(this.sotreQueue)
			this.storeQueue.push(parcel);
		else
			this.storeParcels([parcel]);
	},

	storeParcels(parcels) {
		if(!this.db)
			return;
		var lastKind = null;
		var store = null;
		for(var parcel of parcels) {
			if(lastKind !== parcel.kind) {
				var txn = this.db.transaction(parcel.kind, "readwrite");
				store = txn.objectStore(parcel.kind);
			}
			store.put(parcel.value);
		}
	},

	queryAll(kind, direction, callbacks) {
		if(this.pendingCalls) {
			this.pendingCalls.push(() => { this.queryAll(kind, direction, callbacks) });
			return;
		}
		var txn = this.db.transaction(kind, "readonly");
		var store = txn.objectStore(kind);
		return this.handleCursor(store.openCursor(null, direction), callbacks);
	},

	queryIndex(kind, indexName, range, direction, callbacks) {
		if(this.pendingCalls) {
			this.pendingCalls.push(() => { this.queryIndex(kind, indexName, range, direction, callbacks) });
			return;
		}
		var txn = this.db.transaction(kind, "readonly");
		var store = txn.objectStore(kind);
		var index = store.index(indexName);
		return this.handleCursor(index.openCursor(range, direction), callbacks);
	},

	handleCursor(cursorRequest, callbacks) {
		cursorRequest.onsuccess = function(event) {
			var cursor = event.target.result;
			if(cursor) {
				if(callbacks.record(cursor.value) !== false)
					cursor.continue();
			} else {
				callbacks.end();
			}
		};
	},

	delete(kind, key, callback) {
		if(this.pendingCalls) {
			this.pendingCalls.push(() => { this.delete(key, callback); });
			return;
		}

		var txn = this.db.transaction(kind, "readwrite");
		var store = txn.objectStore(kind);
		var request = store.delete(key);
		request.onsuccess = () => {
			callback();
		};
	}
};

var db = new DatabaseConnection([{ name:"Light", indexes: "title" }]);

function LightCalculation(dimensions, intensity, roomName) {
	var area = dimensions.reduce((accumulator, current) => accumulator*current, 1);
	var lum = area * intensity;
	if(isNaN(lum))
		throw "Invalid parameters";
	this.dimensions = dimensions;
	this.area = area;
	this.intensity = intensity;
	this.lum = lum;
	this.roomName = roomName;
}

LightCalculation.prototype = {
	domParameters(connecting) {
		var result = document.createDocumentFragment();
		var append = result.appendChild.bind(result);
		var text = document.createTextNode.bind(document);
		var node = e => typeof e === "string" ? text(e) : e;
		var span = className => e => {
			var span = document.createElement("span");
			span.textContent = e;
			span.className = className;
			return span;
		};
		var variable = span("var");

		var join = (arr, e) => {
			var first = true;
			e = node(e);
			for(var a of arr) {
				if(first) {
					first = false;
				} else {
					if(e)
						append(e.cloneNode(true));
				}
				append(node(a));
			}
		};

		join(this.dimensions.map(e => e.toLocaleString()+" m").map(variable).concat(), " \u00d7 ");
		join([
			" \u00d7 ",
			variable(this.roomName+" lum/m\u00b2")
		], null);
		if(connecting)
			join([ connecting ]);
		return result;
	},
	formatLum(div) {
		if(typeof div !== "number" || !div)
			div = 1;
		return (this.lum/div).toLocaleString()+" lum";
	},
	bind(title, divisor, output) {
		return new LightPanelController(this, title, divisor, output);
	},
	getRecord() {
		return {
			dimensions: this.dimensions,
			intensity: this.intensity,
			roomName: this.roomName
		};
	}
};

LightCalculation.fromRecord = record => {
	return new LightCalculation(record.dimensions, record.intensity, record.roomName);
};

function LightPanelController(lightCalc, title, divisor, output) {
	this.lightCalc = lightCalc;
	this.title = title;
	this.divisor = divisor;
	this.output = output;
	this.previous = null;
	this.commitTimeout = null;
	this.key = Date.now()+Math.random().toString().replace(/^\d+\./, ".");

	var sync = this.sync.bind(this);
	setTimeout(sync, 0);
	this.divisor.addEventListener("input", sync);
	this.title.addEventListener("input", this.refreshParameters.bind(this));
}

LightPanelController.prototype = {
	getLightCalculation() {
		return this.lightCalc;
	},
	getKey() {
		return this.key;
	},
	refreshParameters() {
		var input = this.divisor;
		var div = parseFloat(input.value);
		var invalid = isNaN(div) || div <= 0;
		input.classList.toggle("error", invalid);
		if(invalid)
			div = 1;
		this.divisorValue = div;

		this.titleValue = this.title.value;
		this.change();
	},
	sync() {
		var output = this.output;
		this.refreshParameters();
		var div = this.divisorValue;
		output.textContent = this.lightCalc.formatLum(div);
	},
	change() {
		if(this.commitTimeout !== null)
			clearTimeout(commitTimeout);
		commitTimeout = setTimeout(this.commit.bind(this), 1000);
	},
	commit() {
		var record = {
			key: this.key,
			title: this.titleValue,
			divisor: this.divisorValue,
			light: this.lightCalc.getRecord()
		};
		var different = this.previous === null;
		if(!different) {
			for(var k in record) {
				// the lightCalc field is final and the object is immutable,
				// so only the string and number fields have to be compared
				if(typeof record[k] !== "object" && record[k] !== this.previous[k]) {
					different = true;
					break;
				}
			}
		}

		if(different) {
			db.store("Light", record);
		}
	},
	bindDelete(btn, success) {
		btn.addEventListener("click", this.delete.bind(this, success));
	},
	delete(successCallback) {
		db.delete("Light", this.key, successCallback);
	},
	applyRecord(record) {
		this.lightCalc = LightCalculation.fromRecord(record.light);
		this.divisor.value = record.divisor;
		this.title.value = record.title;
		this.key = record.key;
		return this;
	}
};

function sync() {
	try {
		var displayName = (intensity.selectedOptions[0] || { }).textContent;
		currentItem = new LightCalculation(dimensions.map(e => parseFloat(e.value)), parseFloat(intensity.value), displayName);
		output.textContent = currentItem.formatLum();
		result.style.display = "";
	} catch (e) {
		currentItem = null;
		output.textContent = "";
		result.style.display = "none";
	}
}

intensity.addEventListener("input", sync);
dimensions.forEach(e => e.addEventListener("input", sync));

function div(className, parent) {
	var d = document.createElement("div");
	d.className = className;
	if(parent && parent.appendChild)
		parent.appendChild(d);
	return d;
}

function inputType(type, parent) {
	var d = document.createElement("input");
	d.type = type;
	if(parent && parent.appendChild)
		parent.appendChild(d);
	return d;
}

function button(caption, parent) {
	var b = document.createElement("button");
	b.type = "button";
	b.textContent = caption;
	if(parent && parent.appendChild)
		parent.appendChild(b);
	return b;
}

var panels = new Map();

function createPanel(bindFunction) {
	var cs = div("compactSheet");
	var rs = div("resultSheet reluctantlyVisibleDelete", cs);
	var input = div("input", rs);
	var output = div("output", rs);

	var titleDiv = div("title", input);
	var title = inputType("text", titleDiv);
	var divisor = inputType("number", input);
	divisor.value = "1";

	var del = button("Delete", rs);
	del.className = "delete";

	var controller = bindFunction(title, divisor, output);
	input.insertBefore(controller.getLightCalculation().domParameters(" / "), divisor);
	controller.bindDelete(del, () => {
		if(cs.parentNode)
			cs.parentNode.removeChild(cs);
	});
	panels.set(controller.getKey(), {
		controller: controller,
		rootElement: cs
	});
	return cs;
}

detach.addEventListener("click", function(e) {
	this.blur();
	if(!currentItem)
		return;

	var cs = createPanel(currentItem.bind.bind(currentItem));

	document.body.insertBefore(cs, script);
});

sync();

var lastSearchTimeout = null;

searchInput.addEventListener("input", e => {
	if(lastSearchTimeout) {
		clearTimeout(lastSearchTimeout);
		lastSearchTimeout = null;
	}
	var value = e.target.value;
	if(value.length > 0) {
		lastSearchTimeout = setTimeout(() => {
			var rest = new Map(panels);
			var counter = 0;
			db.queryIndex("Light", "title", prefixRange(e.target.value), "next", {
				record(record) {
					var panel = panels.get(record.key);
					if(panel) {
						panel.rootElement.classList.add("highlight");
						panel.rootElement.classList.remove("noHighlight");
						rest.delete(record.key);
					} else {
						console.log("Can't find panel for "+record.title);
					}
					++counter;
				},
				end() {
					for(var panel of rest.values()) {
						panel.rootElement.classList.remove("highlight");
						panel.rootElement.classList.add("noHighlight");
					}
					rest = null;
				}
			});
		}, 200);
	} else {
		for(var panel of rest.values())
			panel.rootElement.classList.remove("highlight", "noHighlight");
	}
});

db.queryAll("Light", "prev", {
	record(record) {
		var cs = createPanel((title, divisor, output) => new LightPanelController(null, title, divisor, output).applyRecord(record));
		document.body.appendChild(cs);
	},
	end() {
	}
});
