window.onload = function(){
	// Load and compile PHP scripts
	function loadPHPFiles() {
		var phpFiles = [];
		var scripts = document.getElementsByTagName('script');
		for (var i=0; i<scripts.length; i++) {
			if (scripts[i].type == 'text/php') {
				if (scripts[i].src)
					phpFiles[phpFiles.length] = scripts[i].src;
			}
		}
		
		return phpFiles;
	}
	
	function loadPHPScripts() {
		var phpScripts = [];
		var scripts = document.getElementsByTagName('script');
		for (var i=0; i<scripts.length; i++) {
			if (scripts[i].type == 'text/php') {
				if (scripts[i].innerHTML != '') {
					var script = scripts[i].innerHTML.replace(/\n|\r/g,'');
					script = script.replace(/\s+<\?/,'<?');
					script = script.replace(/\?>\s+/,'?>');
					phpScripts[phpScripts.length] = script;
				}
			}
		}
		
		return phpScripts;
	}
	
	var phpFiles = loadPHPFiles();
	var phpScripts = loadPHPScripts();

	interpreter.interpretPHP(phpFiles, phpScripts);
}

var interpreter = {
	curScript : '',
	curFun : '.global',
	curOp : 0,
	termEventReceived : false,
	
	/**
	 * Interprets an array of JSON-objects with parsekit formatted opcodes.
	 * 
	 * @param {Array} phypeCodes An array of JSON-objects with parsekit formatted opcodes.
	 */
	interpretPHP : function(phpFiles, phpScripts) {
		var output = '';
		for (var i=0; i<phpFiles.length; i++) {
			// Set the currently executing script.
			interpreter.curScript = phpFiles[i];
			
			// Link the variable references in the script to the global variables.
			var phpCode = ajax.gets(phpFiles[i]);
			linker.linkVars(phpCode);

			// Extract parsekit formatted opcodes.
			var phypeCodes = eval(ajax.gets('src/phpToJSON.php?file='+phpFiles[i]));
			
			// Store function table
			funTable = phypeCodes.function_table;
			
			interpreter.curOp = 0;
			interpreter.interpret(phypeCodes);
		}
		
		for (var i=0;i<phpScripts.length; i++) {
			// Set the currently executing script.
			interpreter.curScript = 'scriptTag'+i;
			
			// Link the variable references in the script to the global variables.
			linker.linkVars(phpScripts[i]);
			
			// Extract parsekit formatted opcodes.
			var phypeCodes = eval(ajax.gets('src/proxy.php?script='+escape(phpScripts[i])));
			
			// Store function table
			if (typeof(phypeCodes) != 'undefined') {
				funTable = phypeCodes.function_table;
				
				interpreter.curOp = 0;
				interpreter.interpret(phypeCodes);
			}
		}
	},
	
	interpret : function(phypeCodes) {
		// Iterate through op array.
		while (phypeCodes[interpreter.curOp] &&
				phypeCodes[interpreter.curOp] != 'undefined' &&
				!interpreter.termEventReceived) {
			var op = parser.parse(phypeCodes[interpreter.curOp]);

			//log(interpreter.curOp+';'+op.code+'('+op.arg1.value+', '+op.arg2.value+', '+op.arg3.value+');');
			eval(op.code+'(op.arg1, op.arg2, op.arg3);');
		}
		
		interpreter.termEventReceived = false;
	}, 
	
	terminate : function() {
		interpreter.termEventReceived = true;
	}
}

/////////////
// HELPERS //
/////////////

var parser = {
	/**
	 * Takes a parsekit formatted opcode string and parses it into a JSON object with the properties:
	 *  - command: The name of the opcode.
	 *  - arg1: First argument.
	 *  - arg2: Second argument.
	 *  - arg3: Third argument.
	 * 
	 * @param {String} phypeCode The opcode string to parse.
	 */
	parse : function(phypeCode) {
		var json = {code:'',arg1:{value:'',type:null},arg2:{value:'',type:null},arg3:{value:'',type:null}};
		
		var lastMatched = '';
		var firstSpace = phypeCode.indexOf(' ');
		json.code = phypeCode.substring(0,firstSpace);
		
		var argStr = phypeCode.substring(firstSpace,phypeCode.length);
		json.arg1.value = lastMatched = argStr.match(/('[^']*'|UNUSED|NULL|T\([0-9]+\)|[0-9]+(\.[0-9]+)*|0x[a-fA-F0-9]+|#[0-9]+)/)[0];
		json.arg1.type = parser.getType(json.arg1.value);
		json.arg1.value = parser.getValue(json.arg1.value);
		
		argStr = argStr.substring(lastMatched.length+1,argStr.length);
		json.arg2.value = lastMatched = argStr.match(/('[^']*'|UNUSED|NULL|T\([0-9]+\)|[0-9]+(\.[0-9]+)*|0x[a-fA-F0-9]+|#[0-9]+)/)[0];
		json.arg2.type = parser.getType(json.arg2.value);
		json.arg2.value = parser.getValue(json.arg2.value);

		argStr = argStr.substring(lastMatched.length+1,argStr.length);
		json.arg3.value = argStr.match(/('[^']*'|UNUSED|NULL|T\([0-9]+\)|[0-9]+(\.[0-9]+)*|0x[a-fA-F0-9]+|#[0-9]+)/)[0];
		json.arg3.type = parser.getType(json.arg3.value);
		json.arg3.value = parser.getValue(json.arg3.value);
		
		return json;
	},
	
	/**
	 * Insert the annoying three dots added to strings over 16 chars by parsekit.
	 */
	fakeString : function(str) {
		var dots = '';
		if (str.length > 16)
			dots = '...'; 
		
		return '\''+str+dots+'\'';
	},
	
	/**
	 * Removes pings from strings and removes the annoying three dots added to strings over 16 chars.
	 */
	parseString : function(str) {
		if (str.indexOf('\'')==0 && str.length > 19)
			str = str.substring(0, str.length-3);
		
		return str.substring(1,str.length-1);
	},
	
	/**
	 * Converts variable reference-numbers from "T(xx)" to simply "xx".
	 */
	parseGetNum : function(str) {
		var num = str.match(/[0-9]+/);

		return num[0];
	},
	
	/**
	 * Get the type of an argument.
	 */
	getType : function(arg) {
		if (/UNUSED/.test(arg))
			return ARGT_UNUSED;
		if (/'[^']*'/.test(arg))
			return ARGT_STRING;
		if (/NULL/.test(arg))
			return ARGT_NULL;
		if (/T\([0-9]+\)/.test(arg))
			return ARGT_VAR;
		if (/#[0-9]+/.test(arg))
			return ARGT_OPADDR;
		if (/[0-9]+(\.[0-9]+)*/.test(arg))
			return ARGT_NUM;
		if (/0x[a-fA-F0-9]+/.test(arg))
			return ARGT_HEX;
		return ARGT_UNKNOWN;
	},
	
	/**
	 * Get the value of an argument (removes bogus chars added by parsekit).
	 */
	getValue : function(arg) {
		switch(parser.getType(arg)) {
			case ARGT_STRING:
				return parser.parseString(arg);
			case ARGT_VAR:
			case ARGT_OPADDR:
				return parser.parseGetNum(arg);
			case ARGT_NULL:
			case ARGT_NUM:
			case ARGT_HEX:
			case ARGT_UNUSED:
			case ARGT_UNKNOWN:
				return arg;
		}
	},
	
	/**
	 * Trims white-space and echo's.
	 */
	trim : function(str) {
		// Strip all function declaration blocks.
		str = str.replace(/function\s+[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\([^\)]*\)\s*\{([^\{\}]*|\{[^\}]*\})+\}/g,'');
		
		// Strip white-space and echo's.
		return str.replace(/\s+|echo/g,'');
	},
	
	/**
	 * Returns true if the string is a function call.
	 */
	isFunCall : function(str) {
		return /[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\([^\)]*\);/.test(str);
	},
	
	isArrayAssign : function(str) {
		return /\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\[[^\]]*\]=[^;]+;/.test(str);
	},
	
	isArrayInit : function(str) {
		return /array\([^\)]*\);/.test(str);
	}
}

var linker = {
	assignHash : function(hash, value, scope) {
		if (!scope)
			scope = interpreter.curFun;
			
		if (!symTables[scope])
			symTables[scope] = {};
			
		if (!valTables[scope])
			valTables[scope] = {};
		
		// If our scope is not global, we disregard the var name and simply assign
		// the hash value directly in the val table. The var is local and will not need
		// to be referenced by its name anyway.
		if (scope != '.global' && !symTables[scope][hash]) {
			symTables[scope][hash] = hash;
			valTables[scope][hash] = value;
		} else {
			valTables[scope][symTables[scope][hash]] = value;
		}
	},
	
	assignVar : function(varName, value, scope) {
		if (!scope)
			scope = interpreter.curFun;
		
		if (!valTables[scope])
			valTables[scope] = {};
		
		valTables[scope][varName] = value;
	},
	
	getValue : function(hash) {
		if (symTables[interpreter.curFun] && symTables[interpreter.curFun][hash])
			return valTables[interpreter.curFun][symTables[interpreter.curFun][hash]];
		
		return valTables['.global'][symTables['.global'][hash]];
	},
	
	/*linkArrKey : function(hash, ) {
		
	}*/
	
	linkVar : function(hash, varName, scope) {
		if (!scope)
			scope = interpreter.curFun;
		
		if (!symTables[scope])
			symTables[scope] = {};
		
		symTables[scope][hash] = varName;
		if (!valTables[scope][varName])
			valTables[scope][varName] = null;
	},
	
	unlinkVar : function(hash, scope) {
		if (!scope)
			scope = interpreter.curFun;
		
		delete valTables[symTables[scope][hash]];
		delete symTables[scope][hash];
	},
	
	/**
	 * Links variable references to global variables.
	 * 
	 * @param {String} str The original PHP script.
	 */
	linkVars : function(str) {
		str = parser.trim(str);
		
		// Initialize sym and val tables.
		symTables[interpreter.curFun] = {};
		valTables[interpreter.curFun] = {};
						
		// Find all assignments to arrays, and find all function calls.
		var assigns = str.match(/(\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*(\[[^\]]*\])?=[^;]+;|[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\([^\)]*\);|array\([^\)]*\);)/g);
		if (assigns!=null) {
			var varCount = 0;
			for (var i=0; i<assigns.length; i++) {
				// If the matched string is an assignment, link it to the appropriate global var.
				if (!parser.isFunCall(assigns[i])) {
					// Array assign
					if (parser.isArrayAssign(assigns[i])) {
						var varName = assigns[i].match(/[a-zA-Z0-9_]+\[/)[0];
						varName = varName.substring(0,varName.length-1);
						
						// Make a reference to the value in the sym table
						symTables[interpreter.curFun] = {};
						symTables[interpreter.curFun][varCount] = varName;
						
						// Initialize the value in the val table
						valTables[interpreter.curFun] = {};
						valTables[interpreter.curFun][varName] = {};
						
						// Increase assign-count
						varCount++;
					}
					// Array init
					else if (parser.isArrayInit(assigns[i])) {
						// Make a reference to the value in the sym table
						symTables[interpreter.curFun][varCount] = varName;
						
						// Initialize the value in the val table
						valTables[interpreter.curFun][varCount] = {};
						
						// Increase assign-count
						varCount++;
					}
					// Ordinary var assign
					else {
						var varName = assigns[i].match(/[a-zA-Z0-9_]+=/)[0];
						varName = varName.substring(0,varName.length-1);
						
						// Make a reference to the value in the sym table
						symTables[interpreter.curFun][i] = varName;
						
						// Initialize the value in the val table
						valTables[interpreter.curFun][varName] = null;
					}
				} 
				// If the matched string is a function call, link it to the most recent function return value.
				else {
					symTables[interpreter.curFun][i] = '.return';
				}
				
				varCount++;
			}
		}
		
		
	}
}

var symTables = {};
var valTables = {};
var funTable = {};
var arrTable = {};