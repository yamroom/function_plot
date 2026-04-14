(function () {
  "use strict";

  const BUILTIN_ARITY = Object.freeze({
    exp: [1, 1],
    ln: [1, 1],
    log10: [1, 1],
    sqrt: [1, 1],
    abs: [1, 1],
    min: [2, Infinity],
    max: [2, Infinity],
    pow: [2, 2],
    log1p: [1, 1],
    expm1: [1, 1]
  });

  const RESERVED_IDENTIFIERS = new Set(["x", "pi", "e", ...Object.keys(BUILTIN_ARITY)]);
  const DEFAULT_X_VIEW = Object.freeze({ min: -10, max: 10 });
  const COLOR_POOL = ["#d1495b", "#2c7da0", "#ef8a17", "#2a9d8f", "#6d597a", "#386641"];
  const SETTINGS_FORMAT = "interactive-function-explorer";
  const SETTINGS_VERSION = 1;
  const HOVER_DISTANCE_THRESHOLD_PX = 12;

  const state = {
    functions: [
      { id: "fn-1", definition: "f1(x) = 1/beta*ln(1+exp(beta*x))", color: "#d1495b", enabled: true },
      { id: "fn-2", definition: "f2(x) = max(x,0)", color: "#2c7da0", enabled: true },
      { id: "fn-3", definition: "f3(x) = f1(x)*(1/(1-exp(2*x)))", color: "#ef8a17", enabled: true }
    ],
    parameters: [
      { id: "param-beta", name: "beta", value: 5, min: 0.1, max: 50, step: 0.1 }
    ],
    axis: {
      logX: false,
      logY: false
    },
    view: {
      xMin: DEFAULT_X_VIEW.min,
      xMax: DEFAULT_X_VIEW.max,
      yMin: -1,
      yMax: 5
    },
    hover: null,
    selection: null,
    compiled: null,
    noticeMessages: [],
    runtimeMessages: [],
    nextFunctionIndex: 4,
    nextParameterIndex: 1
  };

  const dom = {
    functionList: document.getElementById("functionList"),
    parameterList: document.getElementById("parameterList"),
    addFunctionBtn: document.getElementById("addFunctionBtn"),
    addParameterBtn: document.getElementById("addParameterBtn"),
    logXToggle: document.getElementById("logXToggle"),
    logYToggle: document.getElementById("logYToggle"),
    xMinInput: document.getElementById("xMinInput"),
    xMaxInput: document.getElementById("xMaxInput"),
    yMinInput: document.getElementById("yMinInput"),
    yMaxInput: document.getElementById("yMaxInput"),
    applyViewBtn: document.getElementById("applyViewBtn"),
    autoFitBtn: document.getElementById("autoFitBtn"),
    resetViewBtn: document.getElementById("resetViewBtn"),
    exportSettingsBtn: document.getElementById("exportSettingsBtn"),
    loadSettingsBtn: document.getElementById("loadSettingsBtn"),
    settingsFileInput: document.getElementById("settingsFileInput"),
    messages: document.getElementById("messages"),
    legend: document.getElementById("legend"),
    plotStatus: document.getElementById("plotStatus"),
    canvasFrame: document.querySelector(".canvas-frame"),
    hoverTooltip: document.getElementById("hoverTooltip"),
    canvas: document.getElementById("plotCanvas")
  };

  const ctx = dom.canvas.getContext("2d");
  const resizeObserver = new ResizeObserver(() => refresh({ renderOnly: true }));

  function init() {
    renderFunctionEditor();
    renderParameterEditor();
    bindStaticEvents();
    resizeObserver.observe(dom.canvas.parentElement);
    syncAxisInputs();
    refresh({ autoFitY: true });
  }

  function bindStaticEvents() {
    dom.addFunctionBtn.addEventListener("click", handleAddFunction);
    dom.addParameterBtn.addEventListener("click", handleAddParameter);
    dom.exportSettingsBtn.addEventListener("click", handleExportSettings);
    dom.loadSettingsBtn.addEventListener("click", () => {
      dom.settingsFileInput.click();
    });
    dom.settingsFileInput.addEventListener("change", handleImportSettings);

    dom.functionList.addEventListener("input", handleFunctionEditorInput);
    dom.functionList.addEventListener("change", handleFunctionEditorInput);
    dom.functionList.addEventListener("click", handleFunctionEditorClick);

    dom.parameterList.addEventListener("input", handleParameterEditorInput);
    dom.parameterList.addEventListener("change", handleParameterEditorInput);
    dom.parameterList.addEventListener("click", handleParameterEditorClick);

    dom.logXToggle.addEventListener("change", () => {
      state.axis.logX = dom.logXToggle.checked;
      refresh({ autoFitY: false });
    });

    dom.logYToggle.addEventListener("change", () => {
      state.axis.logY = dom.logYToggle.checked;
      refresh({ autoFitY: true });
    });

    dom.applyViewBtn.addEventListener("click", () => {
      readViewInputs();
      refresh({ autoFitY: false });
    });

    dom.autoFitBtn.addEventListener("click", () => {
      readViewInputs({ includeY: false });
      refresh({ autoFitY: true });
    });

    dom.resetViewBtn.addEventListener("click", () => {
      state.view.xMin = DEFAULT_X_VIEW.min;
      state.view.xMax = DEFAULT_X_VIEW.max;
      syncAxisInputs();
      refresh({ autoFitY: true });
    });

    [dom.xMinInput, dom.xMaxInput, dom.yMinInput, dom.yMaxInput].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          readViewInputs();
          refresh({ autoFitY: false });
        }
      });
    });

    dom.canvas.addEventListener("pointerdown", handlePointerDown);
    dom.canvas.addEventListener("pointermove", handlePointerMove);
    dom.canvas.addEventListener("pointerup", handlePointerUp);
    dom.canvas.addEventListener("pointerleave", handlePointerLeave);
    dom.canvas.addEventListener("pointercancel", handlePointerCancel);
  }

  function refresh(options) {
    const compiled = options && options.renderOnly && state.compiled ? state.compiled : compileModel();
    state.compiled = compiled;

    if (options && options.autoFitY) {
      autoFitY(compiled);
    }

    syncAxisInputs();
    syncParameterEditor();
    applyValidationState(compiled.messages);

    const plotOutcome = drawPlot(compiled);
    state.runtimeMessages = plotOutcome.runtimeMessages;
    renderLegend(compiled);
    renderMessages(state.noticeMessages, compiled.messages, plotOutcome.runtimeMessages);
    renderStatus(plotOutcome);
  }

  function compileModel() {
    const messages = [];
    const parameterEntries = new Map();
    const parameterErrors = new Set();

    state.parameters.forEach((param) => {
      const name = param.name.trim();
      const numeric = {
        value: toFiniteNumber(param.value),
        min: toFiniteNumber(param.min),
        max: toFiniteNumber(param.max),
        step: toFiniteNumber(param.step)
      };

      if (!name) {
        messages.push(makeMessage("error", "Parameter name is required.", param.id));
        parameterErrors.add(param.id);
        return;
      }

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        messages.push(makeMessage("error", `Parameter "${name}" is not a valid identifier.`, param.id));
        parameterErrors.add(param.id);
      }

      if (RESERVED_IDENTIFIERS.has(name)) {
        messages.push(makeMessage("error", `Parameter "${name}" uses a reserved name.`, param.id));
        parameterErrors.add(param.id);
      }

      if (!Number.isFinite(numeric.value) || !Number.isFinite(numeric.min) || !Number.isFinite(numeric.max) || !Number.isFinite(numeric.step)) {
        messages.push(makeMessage("error", `Parameter "${name}" must use finite numeric values.`, param.id));
        parameterErrors.add(param.id);
      } else {
        if (numeric.min >= numeric.max) {
          messages.push(makeMessage("error", `Parameter "${name}" requires min < max.`, param.id));
          parameterErrors.add(param.id);
        }

        if (numeric.step <= 0) {
          messages.push(makeMessage("error", `Parameter "${name}" requires step > 0.`, param.id));
          parameterErrors.add(param.id);
        }

        if (numeric.value < numeric.min || numeric.value > numeric.max) {
          messages.push(makeMessage("warning", `Parameter "${name}" is outside its slider range.`, param.id));
        }
      }

      if (parameterEntries.has(name)) {
        messages.push(makeMessage("error", `Parameter "${name}" is defined more than once.`, param.id));
        messages.push(makeMessage("error", `Parameter "${name}" is defined more than once.`, parameterEntries.get(name).id));
        parameterErrors.add(param.id);
        parameterErrors.add(parameterEntries.get(name).id);
      } else {
        parameterEntries.set(name, { ...param, ...numeric, name });
      }
    });

    const parameterMap = Object.create(null);
    for (const [name, param] of parameterEntries.entries()) {
      if (!parameterErrors.has(param.id)) {
        parameterMap[name] = param.value;
      }
    }

    const rawFunctions = [];
    const functionEntries = new Map();
    const functionErrors = new Set();

    state.functions.forEach((row) => {
      const definition = row.definition.trim();
      if (!definition) {
        messages.push(makeMessage("error", "Function definition cannot be empty.", row.id));
        functionErrors.add(row.id);
        return;
      }

      try {
        const parsed = parseDefinition(definition);
        rawFunctions.push({ ...row, name: parsed.name, ast: parsed.ast });

        if (RESERVED_IDENTIFIERS.has(parsed.name)) {
          messages.push(makeMessage("error", `Function "${parsed.name}" uses a reserved name.`, row.id));
          functionErrors.add(row.id);
        }

        if (Object.prototype.hasOwnProperty.call(parameterMap, parsed.name)) {
          messages.push(makeMessage("error", `Function "${parsed.name}" conflicts with a parameter name.`, row.id));
          functionErrors.add(row.id);
        }

        if (functionEntries.has(parsed.name)) {
          messages.push(makeMessage("error", `Function "${parsed.name}" is defined more than once.`, row.id));
          messages.push(makeMessage("error", `Function "${parsed.name}" is defined more than once.`, functionEntries.get(parsed.name).id));
          functionErrors.add(row.id);
          functionErrors.add(functionEntries.get(parsed.name).id);
        } else {
          functionEntries.set(parsed.name, row);
        }
      } catch (error) {
        messages.push(makeMessage("error", error.message, row.id));
        functionErrors.add(row.id);
      }
    });

    const validFunctionNames = new Set(
      rawFunctions.filter((item) => !functionErrors.has(item.id)).map((item) => item.name)
    );

    rawFunctions.forEach((item) => {
      if (functionErrors.has(item.id)) {
        return;
      }

      const analysis = analyzeAst(item.ast, validFunctionNames, parameterMap);
      analysis.messages.forEach((message) => {
        messages.push(makeMessage("error", message, item.id));
      });

      if (analysis.messages.length > 0) {
        functionErrors.add(item.id);
        return;
      }

      item.dependencies = analysis.dependencies;
    });

    const cycleMessages = detectCycles(rawFunctions.filter((item) => !functionErrors.has(item.id)));
    cycleMessages.forEach(({ id, message }) => {
      messages.push(makeMessage("error", message, id));
      functionErrors.add(id);
    });

    const compileOrder = topologicalSort(rawFunctions.filter((item) => !functionErrors.has(item.id)));
    const compiledByName = Object.create(null);
    const compiledRows = new Map();

    compileOrder.forEach((item) => {
      const evaluator = compileAst(item.ast, {
        parameterMap,
        compiledByName
      });

      const compiled = {
        id: item.id,
        name: item.name,
        definition: item.definition,
        color: item.color,
        enabled: item.enabled,
        dependencies: item.dependencies || [],
        evaluate: evaluator
      };

      compiledByName[item.name] = evaluator;
      compiledRows.set(item.id, compiled);
    });

    const activeFunctions = state.functions
      .map((row) => compiledRows.get(row.id))
      .filter(Boolean)
      .filter((entry) => entry.enabled);

    return {
      messages,
      parameterMap,
      compiledRows,
      activeFunctions,
      functionCount: activeFunctions.length,
      definitionCount: compiledRows.size
    };
  }

  function analyzeAst(ast, functionNames, parameterMap) {
    const messages = [];
    const dependencies = new Set();
    const parameterNames = new Set(Object.keys(parameterMap));

    walkAst(ast, (node) => {
      if (node.type === "symbol") {
        if (node.name === "x" || node.name === "pi" || node.name === "e" || parameterNames.has(node.name)) {
          return;
        }
        messages.push(`Unknown symbol "${node.name}". Parameters must be declared separately.`);
      }

      if (node.type === "call") {
        const arity = BUILTIN_ARITY[node.name];
        if (arity) {
          if (node.args.length < arity[0] || node.args.length > arity[1]) {
            const expected = arity[0] === arity[1] ? `${arity[0]}` : `${arity[0]}..${arity[1]}`;
            messages.push(`Function "${node.name}" expects ${expected} arguments.`);
          }
          return;
        }

        if (!functionNames.has(node.name)) {
          messages.push(`Unknown function "${node.name}".`);
          return;
        }

        if (node.args.length !== 1) {
          messages.push(`User-defined function "${node.name}" expects exactly one argument.`);
          return;
        }

        dependencies.add(node.name);
      }
    });

    return { messages, dependencies: [...dependencies] };
  }

  function detectCycles(functions) {
    const byName = new Map(functions.map((item) => [item.name, item]));
    const stateByName = new Map();
    const stack = [];
    const cycleMessages = [];

    function visit(name) {
      const marker = stateByName.get(name);
      if (marker === "visiting") {
        const cycleStart = stack.indexOf(name);
        const cyclePath = stack.slice(cycleStart).concat(name);
        const cycleText = cyclePath.join(" -> ");
        cyclePath.slice(0, -1).forEach((cycleName) => {
          const item = byName.get(cycleName);
          if (item) {
            cycleMessages.push({ id: item.id, message: `Circular dependency detected: ${cycleText}` });
          }
        });
        return;
      }

      if (marker === "done") {
        return;
      }

      stateByName.set(name, "visiting");
      stack.push(name);

      const item = byName.get(name);
      (item.dependencies || []).forEach((dependency) => {
        if (byName.has(dependency)) {
          visit(dependency);
        }
      });

      stack.pop();
      stateByName.set(name, "done");
    }

    functions.forEach((item) => visit(item.name));
    return dedupeCycleMessages(cycleMessages);
  }

  function topologicalSort(functions) {
    const byName = new Map(functions.map((item) => [item.name, item]));
    const visited = new Set();
    const ordered = [];

    function visit(name) {
      if (visited.has(name)) {
        return;
      }

      visited.add(name);
      const item = byName.get(name);
      (item.dependencies || []).forEach((dependency) => {
        if (byName.has(dependency)) {
          visit(dependency);
        }
      });
      ordered.push(item);
    }

    functions.forEach((item) => visit(item.name));
    return ordered;
  }

  function compileAst(ast, environment) {
    switch (ast.type) {
      case "number":
        return function compiledNumber() {
          return ast.value;
        };

      case "symbol":
        if (ast.name === "x") {
          return function compiledX(x) {
            return x;
          };
        }

        if (ast.name === "pi") {
          return function compiledPi() {
            return Math.PI;
          };
        }

        if (ast.name === "e") {
          return function compiledE() {
            return Math.E;
          };
        }

        return function compiledParameter() {
          return environment.parameterMap[ast.name];
        };

      case "unary": {
        const arg = compileAst(ast.arg, environment);
        if (ast.op === "+") {
          return function compiledUnaryPlus(x) {
            return +arg(x);
          };
        }

        return function compiledUnaryMinus(x) {
          return -arg(x);
        };
      }

      case "binary": {
        const left = compileAst(ast.left, environment);
        const right = compileAst(ast.right, environment);

        if (ast.op === "+") {
          return function compiledAdd(x) {
            return left(x) + right(x);
          };
        }

        if (ast.op === "-") {
          return function compiledSubtract(x) {
            return left(x) - right(x);
          };
        }

        if (ast.op === "*") {
          return function compiledMultiply(x) {
            return left(x) * right(x);
          };
        }

        if (ast.op === "/") {
          return function compiledDivide(x) {
            return left(x) / right(x);
          };
        }

        return function compiledPower(x) {
          return Math.pow(left(x), right(x));
        };
      }

      case "call": {
        const softplusArg = ast.name === "ln" ? matchSoftplusArg(ast.args[0]) : null;
        if (softplusArg) {
          const inner = compileAst(softplusArg, environment);
          return function compiledSoftplus(x) {
            return stableSoftplus(inner(x));
          };
        }

        const compiledArgs = ast.args.map((arg) => compileAst(arg, environment));
        const builtin = makeBuiltinExecutor(ast.name);
        if (builtin) {
          return function compiledBuiltin(x) {
            const args = compiledArgs.map((executor) => executor(x));
            return builtin(args);
          };
        }

        return function compiledUserFunction(x) {
          const target = environment.compiledByName[ast.name];
          return target(compiledArgs[0](x));
        };
      }

      default:
        throw new Error(`Unsupported AST node "${ast.type}".`);
    }
  }

  function makeBuiltinExecutor(name) {
    switch (name) {
      case "exp":
        return (args) => Math.exp(args[0]);
      case "ln":
        return (args) => Math.log(args[0]);
      case "log10":
        return (args) => Math.log10(args[0]);
      case "sqrt":
        return (args) => Math.sqrt(args[0]);
      case "abs":
        return (args) => Math.abs(args[0]);
      case "min":
        return (args) => Math.min(...args);
      case "max":
        return (args) => Math.max(...args);
      case "pow":
        return (args) => Math.pow(args[0], args[1]);
      case "log1p":
        return (args) => Math.log1p(args[0]);
      case "expm1":
        return (args) => Math.expm1(args[0]);
      default:
        return null;
    }
  }

  function stableSoftplus(value) {
    if (value >= 0) {
      return value + Math.log1p(Math.exp(-value));
    }
    return Math.log1p(Math.exp(value));
  }

  function matchSoftplusArg(node) {
    if (!node || node.type !== "binary" || node.op !== "+") {
      return null;
    }

    const possibilities = [
      [node.left, node.right],
      [node.right, node.left]
    ];

    for (const [oneCandidate, expCandidate] of possibilities) {
      if (isNumericLiteral(oneCandidate, 1) && expCandidate.type === "call" && expCandidate.name === "exp" && expCandidate.args.length === 1) {
        return expCandidate.args[0];
      }
    }

    return null;
  }

  function parseDefinition(definition) {
    const parser = new Parser(tokenize(definition));
    const nameToken = parser.expect("identifier", "Expected a function name at the start of the definition.");
    parser.expect("punct", 'Expected "(" after the function name.', "(");
    const argToken = parser.expect("identifier", 'Expected "x" as the function argument.');
    parser.expect("punct", 'Expected ")" after the function argument.', ")");
    parser.expect("operator", 'Expected "=" after the function signature.', "=");
    const ast = parser.parseExpression();
    parser.expect("eof", "Unexpected extra tokens after the formula.");

    if (argToken.value !== "x") {
      throw new Error(`Function "${nameToken.value}" must use "x" as its argument.`);
    }

    return { name: nameToken.value, ast };
  }

  function tokenize(source) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const char = source[index];

      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (/[A-Za-z_]/.test(char)) {
        const start = index;
        index += 1;
        while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
          index += 1;
        }
        tokens.push({ type: "identifier", value: source.slice(start, index), pos: start });
        continue;
      }

      if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] || ""))) {
        const start = index;
        index += 1;
        while (index < source.length && /\d/.test(source[index])) {
          index += 1;
        }
        if (source[index] === ".") {
          index += 1;
          while (index < source.length && /\d/.test(source[index])) {
            index += 1;
          }
        }
        if ((source[index] === "e" || source[index] === "E") && /[+\-\d]/.test(source[index + 1] || "")) {
          index += 1;
          if (source[index] === "+" || source[index] === "-") {
            index += 1;
          }
          if (!/\d/.test(source[index] || "")) {
            throw syntaxError("Invalid scientific notation.", index);
          }
          while (index < source.length && /\d/.test(source[index])) {
            index += 1;
          }
        }
        tokens.push({ type: "number", value: Number(source.slice(start, index)), pos: start });
        continue;
      }

      if ("+-*/^=".includes(char)) {
        tokens.push({ type: "operator", value: char, pos: index });
        index += 1;
        continue;
      }

      if ("(),".includes(char)) {
        tokens.push({ type: "punct", value: char, pos: index });
        index += 1;
        continue;
      }

      throw syntaxError(`Unexpected character "${char}".`, index);
    }

    tokens.push({ type: "eof", value: "", pos: source.length });
    return tokens;
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.index = 0;
    }

    current() {
      return this.tokens[this.index];
    }

    expect(type, message, value) {
      const token = this.current();
      if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
        throw syntaxError(message, token ? token.pos : -1);
      }
      this.index += 1;
      return token;
    }

    match(type, value) {
      const token = this.current();
      if (token && token.type === type && (value === undefined || token.value === value)) {
        this.index += 1;
        return token;
      }
      return null;
    }

    parseExpression() {
      return this.parseAdditive();
    }

    parseAdditive() {
      let node = this.parseMultiplicative();
      while (true) {
        const operator = this.match("operator", "+") || this.match("operator", "-");
        if (!operator) {
          return node;
        }
        node = {
          type: "binary",
          op: operator.value,
          left: node,
          right: this.parseMultiplicative()
        };
      }
    }

    parseMultiplicative() {
      let node = this.parseUnary();
      while (true) {
        const operator = this.match("operator", "*") || this.match("operator", "/");
        if (!operator) {
          return node;
        }
        node = {
          type: "binary",
          op: operator.value,
          left: node,
          right: this.parseUnary()
        };
      }
    }

    parseUnary() {
      const operator = this.match("operator", "+") || this.match("operator", "-");
      if (operator) {
        return {
          type: "unary",
          op: operator.value,
          arg: this.parseUnary()
        };
      }
      return this.parsePower();
    }

    parsePower() {
      let node = this.parsePrimary();
      const operator = this.match("operator", "^");
      if (!operator) {
        return node;
      }

      node = {
        type: "binary",
        op: operator.value,
        left: node,
        right: this.parseUnary()
      };
      return node;
    }

    parsePrimary() {
      const token = this.current();
      if (!token) {
        throw syntaxError("Unexpected end of input.", -1);
      }

      if (token.type === "number") {
        this.index += 1;
        return { type: "number", value: token.value };
      }

      if (token.type === "identifier") {
        this.index += 1;
        if (this.match("punct", "(")) {
          const args = [];
          if (!this.match("punct", ")")) {
            do {
              args.push(this.parseExpression());
            } while (this.match("punct", ","));
            this.expect("punct", 'Expected ")" to close the call.', ")");
          }
          return { type: "call", name: token.value, args };
        }
        return { type: "symbol", name: token.value };
      }

      if (this.match("punct", "(")) {
        const node = this.parseExpression();
        this.expect("punct", 'Expected ")" to close the grouped expression.', ")");
        return node;
      }

      throw syntaxError(`Unexpected token "${token.value || token.type}".`, token.pos);
    }
  }

  function drawPlot(compiled) {
    const metrics = configureCanvas();
    const viewport = buildViewport(metrics);
    const runtimeMessages = [...viewport.messages];
    const plotRect = viewport.plotRect;

    clearCanvas(metrics.width, metrics.height);
    drawCanvasBackground(metrics.width, metrics.height, plotRect);
    drawGridAndAxes(viewport);

    if (!viewport.ready) {
      drawEmptyState("Adjust the current axis range to reveal a valid plotting window.", plotRect);
      drawSelection(viewport);
      drawHoverOverlay(null);
      syncHoverTooltip(null);
      return { runtimeMessages, sampleCount: 0, plottedFunctions: 0, invalidSamples: 0 };
    }

    if (compiled.activeFunctions.length === 0) {
      drawEmptyState("No valid enabled functions are available to plot.", plotRect);
      drawSelection(viewport);
      drawHoverOverlay(null);
      syncHoverTooltip(null);
      return { runtimeMessages, sampleCount: 0, plottedFunctions: 0, invalidSamples: 0 };
    }

    const sampleCount = Math.max(2, Math.floor(plotRect.width * metrics.dpr));
    let totalInvalidSamples = 0;
    let plottedFunctions = 0;

    compiled.activeFunctions.forEach((fn) => {
      const outcome = drawFunctionCurve(fn, viewport, sampleCount);
      totalInvalidSamples += outcome.invalidSamples;
      if (outcome.validSamples > 0) {
        plottedFunctions += 1;
      }
      if (outcome.invalidSamples > 0) {
        runtimeMessages.push(
          makeMessage("warning", `${fn.name} skipped ${outcome.invalidSamples} samples because they were outside the active domain or not finite.`, fn.id)
        );
      }
    });

    const hoverHit = resolveHoverHit(compiled, viewport);
    drawSelection(viewport);
    drawHoverOverlay(hoverHit);
    syncHoverTooltip(hoverHit);
    return { runtimeMessages, sampleCount, plottedFunctions, invalidSamples: totalInvalidSamples };
  }

  function configureCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));

    if (dom.canvas.width !== Math.floor(width * dpr) || dom.canvas.height !== Math.floor(height * dpr)) {
      dom.canvas.width = Math.floor(width * dpr);
      dom.canvas.height = Math.floor(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { width, height, dpr };
  }

  function buildViewport(metrics) {
    const plotRect = {
      left: 76,
      top: 30,
      width: Math.max(140, metrics.width - 108),
      height: Math.max(140, metrics.height - 88)
    };
    plotRect.right = plotRect.left + plotRect.width;
    plotRect.bottom = plotRect.top + plotRect.height;

    const messages = [];
    const rawXMin = toFiniteNumber(state.view.xMin);
    const rawXMax = toFiniteNumber(state.view.xMax);
    const rawYMin = toFiniteNumber(state.view.yMin);
    const rawYMax = toFiniteNumber(state.view.yMax);

    const xRange = normalizeRange(rawXMin, rawXMax, "x", state.axis.logX, messages);
    const yRange = normalizeRange(rawYMin, rawYMax, "y", state.axis.logY, messages);

    return {
      plotRect,
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      ready: xRange !== null && yRange !== null,
      messages,
      axis: state.axis,
      xRange,
      yRange
    };
  }

  function normalizeRange(minValue, maxValue, axisName, isLog, messages) {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      messages.push(makeMessage("warning", `${axisName}-axis range is incomplete.`, null));
      return null;
    }
    if (minValue === maxValue) {
      messages.push(makeMessage("warning", `${axisName}-axis range collapsed to a single value.`, null));
      return null;
    }
    if (minValue > maxValue) {
      messages.push(makeMessage("warning", `${axisName}-axis range was reversed; plotting is paused until it is corrected.`, null));
      return null;
    }

    let min = minValue;
    const max = maxValue;
    if (!isLog) {
      return { min, max };
    }
    if (max <= 0) {
      messages.push(makeMessage("warning", `Log ${axisName}-axis needs a positive upper bound.`, null));
      return null;
    }
    if (min <= 0) {
      min = derivePositiveLowerBound(max);
      messages.push(makeMessage("warning", `Log ${axisName}-axis ignores the non-positive part of the current range and plots from ${formatNumber(min)} to ${formatNumber(max)}.`, null));
    }
    return min > 0 && max > min ? { min, max } : null;
  }

  function drawCanvasBackground(width, height, plotRect) {
    const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
    baseGradient.addColorStop(0, "#fffdf8");
    baseGradient.addColorStop(1, "#f2ecdf");
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);

    const plotGradient = ctx.createLinearGradient(plotRect.left, plotRect.top, plotRect.right, plotRect.bottom);
    plotGradient.addColorStop(0, "rgba(15, 92, 99, 0.05)");
    plotGradient.addColorStop(1, "rgba(209, 93, 73, 0.04)");
    ctx.fillStyle = plotGradient;
    ctx.fillRect(plotRect.left, plotRect.top, plotRect.width, plotRect.height);
  }

  function drawGridAndAxes(viewport) {
    const { plotRect, xRange, yRange, axis, ready } = viewport;
    ctx.save();
    ctx.strokeStyle = "rgba(23, 33, 43, 0.08)";
    ctx.lineWidth = 1;

    if (ready) {
      const xTicks = axis.logX ? buildLogTicks(xRange.min, xRange.max) : buildLinearTicks(xRange.min, xRange.max, 9);
      const yTicks = axis.logY ? buildLogTicks(yRange.min, yRange.max) : buildLinearTicks(yRange.min, yRange.max, 8);

      xTicks.forEach((tick) => {
        const x = mapXToCanvas(tick.value, viewport);
        if (!Number.isFinite(x)) {
          return;
        }
        ctx.beginPath();
        ctx.moveTo(x, plotRect.top);
        ctx.lineTo(x, plotRect.bottom);
        ctx.stroke();
      });

      yTicks.forEach((tick) => {
        const y = mapYToCanvas(tick.value, viewport);
        if (!Number.isFinite(y)) {
          return;
        }
        ctx.beginPath();
        ctx.moveTo(plotRect.left, y);
        ctx.lineTo(plotRect.right, y);
        ctx.stroke();
      });

      ctx.fillStyle = "rgba(23, 33, 43, 0.74)";
      ctx.font = '12px "Aptos", "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      xTicks.forEach((tick) => {
        const x = mapXToCanvas(tick.value, viewport);
        if (Number.isFinite(x)) {
          ctx.fillText(tick.label, x, plotRect.bottom + 10);
        }
      });

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      yTicks.forEach((tick) => {
        const y = mapYToCanvas(tick.value, viewport);
        if (Number.isFinite(y)) {
          ctx.fillText(tick.label, plotRect.left - 10, y);
        }
      });

      if (!axis.logX && xRange.min <= 0 && xRange.max >= 0) {
        const zeroX = mapXToCanvas(0, viewport);
        ctx.strokeStyle = "rgba(6, 63, 69, 0.45)";
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(zeroX, plotRect.top);
        ctx.lineTo(zeroX, plotRect.bottom);
        ctx.stroke();
      }

      if (!axis.logY && yRange.min <= 0 && yRange.max >= 0) {
        const zeroY = mapYToCanvas(0, viewport);
        ctx.strokeStyle = "rgba(6, 63, 69, 0.45)";
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(plotRect.left, zeroY);
        ctx.lineTo(plotRect.right, zeroY);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(23, 33, 43, 0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(plotRect.left, plotRect.top, plotRect.width, plotRect.height);
    ctx.restore();
  }

  function drawFunctionCurve(fn, viewport, sampleCount) {
    const { plotRect } = viewport;
    let invalidSamples = 0;
    let validSamples = 0;
    let prevPoint = null;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotRect.left, plotRect.top, plotRect.width, plotRect.height);
    ctx.clip();
    ctx.lineWidth = 2.25;
    ctx.strokeStyle = fn.color;
    ctx.beginPath();

    for (let index = 0; index < sampleCount; index += 1) {
      const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
      const x = interpolateX(t, viewport);
      let y;
      try {
        y = fn.evaluate(x);
      } catch (error) {
        y = Number.NaN;
      }

      const point = buildPoint(y, t, viewport);
      if (!point.valid) {
        invalidSamples += 1;
        prevPoint = null;
        continue;
      }

      if (prevPoint && Math.abs(point.canvasY - prevPoint.canvasY) <= plotRect.height * 1.75) {
        ctx.lineTo(point.canvasX, point.canvasY);
      } else {
        ctx.moveTo(point.canvasX, point.canvasY);
      }

      prevPoint = point;
      validSamples += 1;
    }

    ctx.stroke();
    ctx.restore();
    return { invalidSamples, validSamples };
  }

  function buildPoint(y, t, viewport) {
    if (!Number.isFinite(y) || (viewport.axis.logY && y <= 0)) {
      return { valid: false };
    }

    const canvasX = viewport.plotRect.left + t * viewport.plotRect.width;
    const canvasY = mapYToCanvas(y, viewport);
    if (!Number.isFinite(canvasY)) {
      return { valid: false };
    }
    return { valid: true, canvasX, canvasY };
  }

  function drawSelection(viewport) {
    if (!state.selection || !state.selection.active) {
      return;
    }

    const rect = selectionRect(state.selection);
    const clipped = clipRectToPlot(rect, viewport.plotRect);
    if (!clipped) {
      return;
    }

    ctx.save();
    ctx.fillStyle = "rgba(15, 92, 99, 0.14)";
    ctx.strokeStyle = "rgba(6, 63, 69, 0.7)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(clipped.left, clipped.top, clipped.width, clipped.height);
    ctx.strokeRect(clipped.left, clipped.top, clipped.width, clipped.height);
    ctx.restore();
  }

  function resolveHoverHit(compiled, viewport) {
    if (!state.hover || state.selection || !viewport.ready || compiled.activeFunctions.length === 0) {
      state.hover = null;
      return null;
    }

    const pointer = { x: state.hover.pointerX, y: state.hover.pointerY };
    if (!isInsideRect(pointer, viewport.plotRect)) {
      state.hover = null;
      return null;
    }

    const x = mapCanvasToX(pointer.x, viewport);
    if (!Number.isFinite(x)) {
      return null;
    }

    let closest = null;
    compiled.activeFunctions.forEach((fn) => {
      let y;
      try {
        y = fn.evaluate(x);
      } catch (error) {
        y = Number.NaN;
      }

      if (!Number.isFinite(y) || (viewport.axis.logY && y <= 0)) {
        return;
      }

      const canvasY = mapYToCanvas(y, viewport);
      if (!Number.isFinite(canvasY) || canvasY < viewport.plotRect.top || canvasY > viewport.plotRect.bottom) {
        return;
      }

      const distancePx = Math.abs(canvasY - pointer.y);
      if (distancePx > HOVER_DISTANCE_THRESHOLD_PX) {
        return;
      }

      if (!closest || distancePx < closest.distancePx) {
        closest = {
          fn,
          x,
          y,
          canvasX: pointer.x,
          canvasY,
          distancePx
        };
      }
    });

    state.hover = closest
      ? { pointerX: pointer.x, pointerY: pointer.y, hit: closest }
      : { pointerX: pointer.x, pointerY: pointer.y, hit: null };

    return closest;
  }

  function drawHoverOverlay(hoverHit) {
    if (!hoverHit) {
      return;
    }

    ctx.save();
    ctx.fillStyle = hoverHit.fn.color;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hoverHit.canvasX, hoverHit.canvasY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function syncHoverTooltip(hoverHit) {
    if (!dom.hoverTooltip) {
      return;
    }

    if (!hoverHit) {
      dom.hoverTooltip.setAttribute("hidden", "");
      dom.hoverTooltip.setAttribute("aria-hidden", "true");
      dom.hoverTooltip.innerHTML = "";
      return;
    }

    dom.hoverTooltip.innerHTML = `
      <div class="plot-tooltip-title">
        <span class="plot-tooltip-swatch" style="background:${escapeHtml(hoverHit.fn.color)}"></span>
        <strong>${escapeHtml(hoverHit.fn.name)}</strong>
      </div>
      <div>x = ${escapeHtml(formatNumber(hoverHit.x))}</div>
      <div>y = ${escapeHtml(formatNumber(hoverHit.y))}</div>
    `;
    dom.hoverTooltip.removeAttribute("hidden");
    dom.hoverTooltip.setAttribute("aria-hidden", "false");

    const frameWidth = dom.canvasFrame.clientWidth;
    const frameHeight = dom.canvasFrame.clientHeight;
    const tooltipWidth = dom.hoverTooltip.offsetWidth;
    const tooltipHeight = dom.hoverTooltip.offsetHeight;
    const margin = 12;
    let left = hoverHit.canvasX + 14;
    let top = hoverHit.canvasY - tooltipHeight - 14;

    if (left + tooltipWidth > frameWidth - margin) {
      left = hoverHit.canvasX - tooltipWidth - 14;
    }
    if (left < margin) {
      left = margin;
    }
    if (top < margin) {
      top = hoverHit.canvasY + 14;
    }
    if (top + tooltipHeight > frameHeight - margin) {
      top = Math.max(margin, frameHeight - tooltipHeight - margin);
    }

    dom.hoverTooltip.style.left = `${Math.round(left)}px`;
    dom.hoverTooltip.style.top = `${Math.round(top)}px`;
  }

  function drawEmptyState(text, plotRect) {
    ctx.save();
    ctx.fillStyle = "rgba(23, 33, 43, 0.7)";
    ctx.font = '16px "Aptos", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, plotRect.left + plotRect.width / 2, plotRect.top + plotRect.height / 2);
    ctx.restore();
  }

  function clearCanvas(width, height) {
    ctx.clearRect(0, 0, width, height);
  }

  function renderFunctionEditor() {
    dom.functionList.innerHTML = state.functions.map((row, index) => `
      <div class="function-card" data-row-id="${row.id}">
        <div class="card-top">
          <div class="left">
            <label class="toggle-pill">
              <input class="fn-enabled" type="checkbox" ${row.enabled ? "checked" : ""}>
              <span>Show</span>
            </label>
            <strong>Function ${index + 1}</strong>
          </div>
          <div class="left">
            <input class="fn-color" type="color" value="${escapeHtml(row.color)}" aria-label="Function color">
            <button class="ghost-button remove-function" type="button">Remove</button>
          </div>
        </div>
        <input class="definition-input" type="text" value="${escapeHtml(row.definition)}" spellcheck="false" autocomplete="off">
        <div class="row-errors"></div>
      </div>
    `).join("");
  }

  function renderParameterEditor() {
    dom.parameterList.innerHTML = state.parameters.map((row, index) => `
      <div class="parameter-card" data-row-id="${row.id}">
        <div class="card-top">
          <div class="left">
            <strong>Parameter ${index + 1}</strong>
          </div>
          <button class="ghost-button remove-parameter" type="button">Remove</button>
        </div>
        <div class="param-main">
          <label><span>Name</span><input class="param-name" type="text" value="${escapeHtml(row.name)}" spellcheck="false" autocomplete="off"></label>
          <label><span>Value</span><input class="param-value" type="number" step="any" value="${escapeHtml(String(row.value))}"></label>
        </div>
        <div class="param-range">
          <label><span>Min</span><input class="param-min" type="number" step="any" value="${escapeHtml(String(row.min))}"></label>
          <label><span>Max</span><input class="param-max" type="number" step="any" value="${escapeHtml(String(row.max))}"></label>
          <label><span>Step</span><input class="param-step" type="number" step="any" value="${escapeHtml(String(row.step))}"></label>
        </div>
        <div class="slider-row">
          <input class="param-slider" type="range">
          <output class="slider-value">${escapeHtml(formatNumber(row.value))}</output>
        </div>
        <div class="row-errors"></div>
      </div>
    `).join("");
  }

  function syncParameterEditor() {
    state.parameters.forEach((row) => {
      const card = dom.parameterList.querySelector(`[data-row-id="${row.id}"]`);
      if (!card) {
        return;
      }

      const slider = card.querySelector(".param-slider");
      const valueOutput = card.querySelector(".slider-value");
      const min = toFiniteNumber(row.min);
      const max = toFiniteNumber(row.max);
      const step = toFiniteNumber(row.step);
      const value = toFiniteNumber(row.value);
      const sliderReady = Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && Number.isFinite(value) && min < max && step > 0;

      slider.disabled = !sliderReady;
      if (sliderReady) {
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(clamp(value, min, max));
      } else {
        slider.removeAttribute("min");
        slider.removeAttribute("max");
        slider.removeAttribute("step");
        slider.value = "0";
      }

      valueOutput.textContent = formatNumber(value);
    });
  }

  function applyValidationState(messages) {
    const grouped = new Map();
    messages.forEach((message) => {
      if (!message.rowId) {
        return;
      }
      if (!grouped.has(message.rowId)) {
        grouped.set(message.rowId, []);
      }
      grouped.get(message.rowId).push(message);
    });

    dom.functionList.querySelectorAll(".function-card").forEach((card) => {
      const rowMessages = grouped.get(card.dataset.rowId) || [];
      card.classList.toggle("has-error", rowMessages.some((item) => item.level === "error"));
      card.querySelector(".row-errors").innerHTML = rowMessages.filter((item) => item.level === "error").map((item) => `<div class="row-error">${escapeHtml(item.text)}</div>`).join("");
    });

    dom.parameterList.querySelectorAll(".parameter-card").forEach((card) => {
      const rowMessages = grouped.get(card.dataset.rowId) || [];
      card.classList.toggle("has-error", rowMessages.some((item) => item.level === "error"));
      card.querySelector(".row-errors").innerHTML = rowMessages.filter((item) => item.level === "error").map((item) => `<div class="row-error">${escapeHtml(item.text)}</div>`).join("");
    });
  }

  function renderLegend(compiled) {
    if (compiled.activeFunctions.length === 0) {
      dom.legend.innerHTML = '<div class="legend-item"><span>No active curves</span></div>';
      return;
    }

    dom.legend.innerHTML = compiled.activeFunctions.map((fn) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${escapeHtml(fn.color)}"></span>
        <span>${escapeHtml(fn.name)}</span>
      </div>
    `).join("");
  }

  function renderMessages(noticeMessages, validationMessages, runtimeMessages) {
    const allMessages = [...noticeMessages, ...validationMessages, ...runtimeMessages];
    if (allMessages.length === 0) {
      dom.messages.innerHTML = '<div class="message info empty">All current formulas and ranges compiled successfully.</div>';
      return;
    }

    dom.messages.innerHTML = allMessages.map((message) => `
      <div class="message ${message.level}">
        ${escapeHtml(message.text)}
      </div>
    `).join("");
  }

  function renderStatus(plotOutcome) {
    const samplesText = plotOutcome.sampleCount > 0 ? `${plotOutcome.sampleCount.toLocaleString()} direct samples / curve` : "No active samples";
    dom.plotStatus.textContent = `${plotOutcome.plottedFunctions} plotted functions | ${samplesText}`;
  }

  function handleExportSettings() {
    try {
      const snapshot = serializeStateForExport();
      validateImportedSettings(snapshot);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "function-explorer-settings.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("info", "Settings exported to JSON.");
    } catch (error) {
      setNotice("error", `Could not export settings: ${error.message}`);
    }
    refresh({ renderOnly: true });
  }

  async function handleImportSettings(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const snapshot = parseImportedSettings(text);
      applyImportedSettings(snapshot);
      renderFunctionEditor();
      renderParameterEditor();
      setNotice("info", `Loaded settings from ${file.name}.`);
      refresh({ autoFitY: false });
    } catch (error) {
      setNotice("error", `Could not load settings: ${error.message}`);
      refresh({ renderOnly: true });
    } finally {
      dom.settingsFileInput.value = "";
    }
  }

  function serializeStateForExport() {
    return {
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION,
      functions: state.functions.map((row) => ({
        definition: row.definition,
        color: row.color,
        enabled: !!row.enabled
      })),
      parameters: state.parameters.map((row) => ({
        name: row.name,
        value: toFiniteNumber(row.value),
        min: toFiniteNumber(row.min),
        max: toFiniteNumber(row.max),
        step: toFiniteNumber(row.step)
      })),
      axis: {
        logX: !!state.axis.logX,
        logY: !!state.axis.logY
      },
      view: {
        xMin: toFiniteNumber(state.view.xMin),
        xMax: toFiniteNumber(state.view.xMax),
        yMin: toFiniteNumber(state.view.yMin),
        yMax: toFiniteNumber(state.view.yMax)
      }
    };
  }

  function parseImportedSettings(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Error("The selected file is not valid JSON.");
    }
    return validateImportedSettings(raw);
  }

  function validateImportedSettings(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Settings file must contain a top-level object.");
    }
    if (raw.format !== SETTINGS_FORMAT) {
      throw new Error(`Unsupported settings format "${raw.format ?? ""}".`);
    }
    if (raw.version !== SETTINGS_VERSION) {
      throw new Error(`Unsupported settings version "${raw.version ?? ""}".`);
    }
    if (!Array.isArray(raw.functions) || !Array.isArray(raw.parameters)) {
      throw new Error("Settings file is missing the functions or parameters array.");
    }

    const functions = raw.functions.map((entry, index) => validateImportedFunction(entry, index));
    const parameters = raw.parameters.map((entry, index) => validateImportedParameter(entry, index));
    const axis = validateImportedAxis(raw.axis);
    const view = validateImportedView(raw.view);

    return { functions, parameters, axis, view };
  }

  function validateImportedFunction(entry, index) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Function entry ${index + 1} must be an object.`);
    }
    if (typeof entry.definition !== "string" || entry.definition.trim() === "") {
      throw new Error(`Function entry ${index + 1} is missing a definition.`);
    }
    if (typeof entry.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(entry.color)) {
      throw new Error(`Function entry ${index + 1} has an invalid color.`);
    }
    if (typeof entry.enabled !== "boolean") {
      throw new Error(`Function entry ${index + 1} must include a boolean enabled flag.`);
    }
    return {
      definition: entry.definition,
      color: entry.color,
      enabled: entry.enabled
    };
  }

  function validateImportedParameter(entry, index) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Parameter entry ${index + 1} must be an object.`);
    }

    const name = typeof entry.name === "string" ? entry.name : "";
    const value = toFiniteNumber(entry.value);
    const min = toFiniteNumber(entry.min);
    const max = toFiniteNumber(entry.max);
    const step = toFiniteNumber(entry.step);

    if (!name.trim()) {
      throw new Error(`Parameter entry ${index + 1} is missing a name.`);
    }
    if (![value, min, max, step].every(Number.isFinite)) {
      throw new Error(`Parameter "${name}" must use finite numeric values.`);
    }
    if (min >= max) {
      throw new Error(`Parameter "${name}" requires min < max.`);
    }
    if (step <= 0) {
      throw new Error(`Parameter "${name}" requires step > 0.`);
    }

    return { name, value, min, max, step };
  }

  function validateImportedAxis(axis) {
    if (!axis || typeof axis !== "object" || Array.isArray(axis)) {
      throw new Error("Settings file is missing the axis object.");
    }
    if (typeof axis.logX !== "boolean" || typeof axis.logY !== "boolean") {
      throw new Error("Axis settings must include boolean logX/logY values.");
    }
    return { logX: axis.logX, logY: axis.logY };
  }

  function validateImportedView(view) {
    if (!view || typeof view !== "object" || Array.isArray(view)) {
      throw new Error("Settings file is missing the view object.");
    }

    const xMin = toFiniteNumber(view.xMin);
    const xMax = toFiniteNumber(view.xMax);
    const yMin = toFiniteNumber(view.yMin);
    const yMax = toFiniteNumber(view.yMax);
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
      throw new Error("View settings must use finite numeric values.");
    }
    if (xMin >= xMax || yMin >= yMax) {
      throw new Error("View settings require min < max on both axes.");
    }
    return { xMin, xMax, yMin, yMax };
  }

  function applyImportedSettings(snapshot) {
    state.functions = snapshot.functions.map((entry, index) => ({
      id: buildRowId("fn", index),
      definition: entry.definition,
      color: entry.color,
      enabled: entry.enabled
    }));
    state.parameters = snapshot.parameters.map((entry, index) => ({
      id: buildRowId("param", index),
      name: entry.name,
      value: entry.value,
      min: entry.min,
      max: entry.max,
      step: entry.step
    }));
    state.axis = { ...snapshot.axis };
    state.view = { ...snapshot.view };
    state.hover = null;
    state.selection = null;
    state.compiled = null;
    state.runtimeMessages = [];
    state.nextFunctionIndex = deriveNextFunctionIndex(state.functions);
    state.nextParameterIndex = deriveNextParameterIndex(state.parameters);
  }

  function handleAddFunction() {
    const index = state.nextFunctionIndex++;
    state.functions.push({
      id: `fn-${Date.now()}-${index}`,
      definition: `f${index}(x) = x`,
      color: COLOR_POOL[(index - 1) % COLOR_POOL.length],
      enabled: true
    });
    renderFunctionEditor();
    refresh({ autoFitY: false });
  }

  function handleAddParameter() {
    const index = state.nextParameterIndex++;
    state.parameters.push({
      id: `param-${Date.now()}-${index}`,
      name: `a${index}`,
      value: 1,
      min: -10,
      max: 10,
      step: 0.1
    });
    renderParameterEditor();
    refresh({ autoFitY: false });
  }

  function handleFunctionEditorClick(event) {
    const removeButton = event.target.closest(".remove-function");
    if (!removeButton) {
      return;
    }
    const card = event.target.closest(".function-card");
    if (!card) {
      return;
    }
    state.functions = state.functions.filter((row) => row.id !== card.dataset.rowId);
    renderFunctionEditor();
    refresh({ autoFitY: true });
  }

  function handleParameterEditorClick(event) {
    const removeButton = event.target.closest(".remove-parameter");
    if (!removeButton) {
      return;
    }
    const card = event.target.closest(".parameter-card");
    if (!card) {
      return;
    }
    state.parameters = state.parameters.filter((row) => row.id !== card.dataset.rowId);
    renderParameterEditor();
    refresh({ autoFitY: true });
  }

  function handleFunctionEditorInput(event) {
    const card = event.target.closest(".function-card");
    if (!card) {
      return;
    }
    const row = state.functions.find((entry) => entry.id === card.dataset.rowId);
    if (!row) {
      return;
    }

    if (event.target.classList.contains("definition-input")) {
      row.definition = event.target.value;
    } else if (event.target.classList.contains("fn-color")) {
      row.color = event.target.value;
    } else if (event.target.classList.contains("fn-enabled")) {
      row.enabled = event.target.checked;
    } else {
      return;
    }

    refresh({ autoFitY: false });
  }

  function handleParameterEditorInput(event) {
    const card = event.target.closest(".parameter-card");
    if (!card) {
      return;
    }
    const row = state.parameters.find((entry) => entry.id === card.dataset.rowId);
    if (!row) {
      return;
    }

    if (event.target.classList.contains("param-name")) {
      row.name = event.target.value;
    } else if (event.target.classList.contains("param-value")) {
      row.value = event.target.value;
    } else if (event.target.classList.contains("param-min")) {
      row.min = event.target.value;
    } else if (event.target.classList.contains("param-max")) {
      row.max = event.target.value;
    } else if (event.target.classList.contains("param-step")) {
      row.step = event.target.value;
    } else if (event.target.classList.contains("param-slider")) {
      row.value = event.target.value;
      card.querySelector(".param-value").value = event.target.value;
    } else {
      return;
    }

    refresh({ autoFitY: false });
  }

  function handlePointerDown(event) {
    const metrics = configureCanvas();
    const point = eventPoint(event);
    const plotRect = {
      left: 76,
      top: 30,
      width: Math.max(140, metrics.width - 108),
      height: Math.max(140, metrics.height - 88)
    };
    plotRect.right = plotRect.left + plotRect.width;
    plotRect.bottom = plotRect.top + plotRect.height;

    if (!isInsideRect(point, plotRect)) {
      return;
    }

    clearHover();
    state.selection = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    };
    dom.canvas.setPointerCapture(event.pointerId);
    refresh({ renderOnly: true });
  }

  function handlePointerMove(event) {
    const point = eventPoint(event);

    if (state.selection && state.selection.active && state.selection.pointerId === event.pointerId) {
      state.selection.currentX = point.x;
      state.selection.currentY = point.y;
      refresh({ renderOnly: true });
      return;
    }

    updateHover(point);
    refresh({ renderOnly: true });
  }

  function handlePointerUp(event) {
    if (!state.selection || !state.selection.active || state.selection.pointerId !== event.pointerId) {
      return;
    }

    const viewport = buildViewport(configureCanvas());
    const rect = clipRectToPlot(selectionRect(state.selection), viewport.plotRect);
    cancelSelection();

    if (!viewport.ready || !rect || rect.width < 8 || rect.height < 8) {
      refresh({ renderOnly: true });
      return;
    }

    const x1 = mapCanvasToX(rect.left, viewport);
    const x2 = mapCanvasToX(rect.left + rect.width, viewport);
    const y1 = mapCanvasToY(rect.top + rect.height, viewport);
    const y2 = mapCanvasToY(rect.top, viewport);

    state.view.xMin = Math.min(x1, x2);
    state.view.xMax = Math.max(x1, x2);
    state.view.yMin = Math.min(y1, y2);
    state.view.yMax = Math.max(y1, y2);
    syncAxisInputs();
    refresh({ autoFitY: false });
  }

  function handlePointerLeave(event) {
    if (state.selection && state.selection.active && state.selection.pointerId === event.pointerId) {
      handlePointerUp(event);
      return;
    }

    if (state.hover) {
      clearHover();
      refresh({ renderOnly: true });
    }
  }

  function handlePointerCancel() {
    cancelSelection();
    clearHover();
    refresh({ renderOnly: true });
  }

  function cancelSelection() {
    state.selection = null;
  }

  function clearHover() {
    state.hover = null;
  }

  function updateHover(point) {
    const viewport = buildViewport(configureCanvas());
    if (!viewport.ready || !isInsideRect(point, viewport.plotRect)) {
      clearHover();
      return;
    }

    state.hover = {
      pointerX: point.x,
      pointerY: point.y,
      hit: null
    };
  }

  function autoFitY(compiled) {
    const viewport = buildAutoFitViewport(configureCanvas());
    if (!viewport || compiled.activeFunctions.length === 0) {
      return;
    }

    const sampleCount = Math.max(256, Math.floor(viewport.plotRect.width * viewport.dpr));
    let min = Infinity;
    let max = -Infinity;

    compiled.activeFunctions.forEach((fn) => {
      for (let index = 0; index < sampleCount; index += 1) {
        const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        const x = interpolateX(t, viewport);
        let y;
        try {
          y = fn.evaluate(x);
        } catch (error) {
          y = Number.NaN;
        }
        if (!Number.isFinite(y) || (state.axis.logY && y <= 0)) {
          continue;
        }
        min = Math.min(min, y);
        max = Math.max(max, y);
      }
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }

    if (state.axis.logY) {
      const safeMin = Math.max(min, derivePositiveLowerBound(max));
      const safeMax = Math.max(max, safeMin * 1.01);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const padding = Math.max(0.08, (logMax - logMin) * 0.08);
      state.view.yMin = Math.pow(10, logMin - padding);
      state.view.yMax = Math.pow(10, logMax + padding);
      return;
    }

    if (min === max) {
      const padding = min === 0 ? 1 : Math.abs(min) * 0.2;
      state.view.yMin = min - padding;
      state.view.yMax = max + padding;
      return;
    }

    const padding = (max - min) * 0.08;
    state.view.yMin = min - padding;
    state.view.yMax = max + padding;
  }

  function buildAutoFitViewport(metrics) {
    const plotRect = {
      left: 76,
      top: 30,
      width: Math.max(140, metrics.width - 108),
      height: Math.max(140, metrics.height - 88)
    };
    plotRect.right = plotRect.left + plotRect.width;
    plotRect.bottom = plotRect.top + plotRect.height;

    const messages = [];
    const xRange = normalizeRange(toFiniteNumber(state.view.xMin), toFiniteNumber(state.view.xMax), "x", state.axis.logX, messages);
    if (!xRange) {
      return null;
    }

    return {
      plotRect,
      dpr: metrics.dpr,
      axis: state.axis,
      xRange
    };
  }

  function readViewInputs(options = {}) {
    const { includeY = true } = options;
    state.view.xMin = dom.xMinInput.value;
    state.view.xMax = dom.xMaxInput.value;
    if (includeY) {
      state.view.yMin = dom.yMinInput.value;
      state.view.yMax = dom.yMaxInput.value;
    }
  }

  function syncAxisInputs() {
    dom.logXToggle.checked = state.axis.logX;
    dom.logYToggle.checked = state.axis.logY;
    dom.xMinInput.value = formatNumber(state.view.xMin);
    dom.xMaxInput.value = formatNumber(state.view.xMax);
    dom.yMinInput.value = formatNumber(state.view.yMin);
    dom.yMaxInput.value = formatNumber(state.view.yMax);
  }

  function buildLinearTicks(min, max, targetCount) {
    const range = niceNumber(max - min, false);
    const step = niceNumber(range / Math.max(1, targetCount - 1), true);
    const niceMin = Math.ceil(min / step) * step;
    const ticks = [];
    for (let value = niceMin; value <= max + step * 0.5; value += step) {
      ticks.push({ value, label: formatTick(value) });
    }
    return ticks;
  }

  function buildLogTicks(min, max) {
    const ticks = [];
    const minExponent = Math.floor(Math.log10(min));
    const maxExponent = Math.ceil(Math.log10(max));
    for (let exponent = minExponent; exponent <= maxExponent; exponent += 1) {
      const value = Math.pow(10, exponent);
      if (value >= min && value <= max) {
        ticks.push({ value, label: `1e${exponent}` });
      }
    }
    return ticks;
  }

  function mapXToCanvas(value, viewport) {
    const { plotRect, xRange, axis } = viewport;
    if (axis.logX) {
      return plotRect.left + (Math.log(value) - Math.log(xRange.min)) / (Math.log(xRange.max) - Math.log(xRange.min)) * plotRect.width;
    }
    return plotRect.left + (value - xRange.min) / (xRange.max - xRange.min) * plotRect.width;
  }

  function mapYToCanvas(value, viewport) {
    const { plotRect, yRange, axis } = viewport;
    if (axis.logY) {
      return plotRect.bottom - (Math.log(value) - Math.log(yRange.min)) / (Math.log(yRange.max) - Math.log(yRange.min)) * plotRect.height;
    }
    return plotRect.bottom - (value - yRange.min) / (yRange.max - yRange.min) * plotRect.height;
  }

  function mapCanvasToX(canvasX, viewport) {
    const t = clamp((canvasX - viewport.plotRect.left) / viewport.plotRect.width, 0, 1);
    return interpolateX(t, viewport);
  }

  function mapCanvasToY(canvasY, viewport) {
    const t = clamp((viewport.plotRect.bottom - canvasY) / viewport.plotRect.height, 0, 1);
    if (viewport.axis.logY) {
      const logValue = Math.log(viewport.yRange.min) + t * (Math.log(viewport.yRange.max) - Math.log(viewport.yRange.min));
      return Math.exp(logValue);
    }
    return viewport.yRange.min + t * (viewport.yRange.max - viewport.yRange.min);
  }

  function interpolateX(t, viewport) {
    if (viewport.axis.logX) {
      const logValue = Math.log(viewport.xRange.min) + t * (Math.log(viewport.xRange.max) - Math.log(viewport.xRange.min));
      return Math.exp(logValue);
    }
    return viewport.xRange.min + t * (viewport.xRange.max - viewport.xRange.min);
  }

  function selectionRect(selection) {
    if (!selection) {
      return null;
    }
    const left = Math.min(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const right = Math.max(selection.startX, selection.currentX);
    const bottom = Math.max(selection.startY, selection.currentY);
    return { left, top, width: right - left, height: bottom - top };
  }

  function clipRectToPlot(rect, plotRect) {
    if (!rect) {
      return null;
    }
    const left = clamp(rect.left, plotRect.left, plotRect.right);
    const top = clamp(rect.top, plotRect.top, plotRect.bottom);
    const right = clamp(rect.left + rect.width, plotRect.left, plotRect.right);
    const bottom = clamp(rect.top + rect.height, plotRect.top, plotRect.bottom);
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
  }

  function eventPoint(event) {
    const rect = dom.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function isInsideRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function walkAst(node, visitor) {
    visitor(node);
    if (node.type === "unary") {
      walkAst(node.arg, visitor);
      return;
    }
    if (node.type === "binary") {
      walkAst(node.left, visitor);
      walkAst(node.right, visitor);
      return;
    }
    if (node.type === "call") {
      node.args.forEach((arg) => walkAst(arg, visitor));
    }
  }

  function setNotice(level, text) {
    state.noticeMessages = [makeMessage(level, text, null)];
  }

  function buildRowId(prefix, index) {
    return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function deriveNextFunctionIndex(functions) {
    let maxIndex = functions.length;
    functions.forEach((row) => {
      try {
        const parsed = parseDefinition(row.definition.trim());
        const match = /^f(\d+)$/.exec(parsed.name);
        if (match) {
          maxIndex = Math.max(maxIndex, Number(match[1]));
        }
      } catch (error) {
        maxIndex = Math.max(maxIndex, functions.length);
      }
    });
    return maxIndex + 1;
  }

  function deriveNextParameterIndex(parameters) {
    let maxIndex = parameters.length;
    parameters.forEach((row) => {
      const match = /^a(\d+)$/.exec(String(row.name || "").trim());
      if (match) {
        maxIndex = Math.max(maxIndex, Number(match[1]));
      }
    });
    return maxIndex + 1;
  }

  function makeMessage(level, text, rowId) {
    return { level, text, rowId };
  }

  function dedupeCycleMessages(messages) {
    const seen = new Set();
    return messages.filter((message) => {
      const key = `${message.id}:${message.message}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function syntaxError(message, position) {
    return new Error(position >= 0 ? `${message} At character ${position + 1}.` : message);
  }

  function niceNumber(value, roundResult) {
    const exponent = Math.floor(Math.log10(Math.abs(value || 1)));
    const fraction = value / Math.pow(10, exponent);
    let niceFraction;
    if (roundResult) {
      if (fraction < 1.5) {
        niceFraction = 1;
      } else if (fraction < 3) {
        niceFraction = 2;
      } else if (fraction < 7) {
        niceFraction = 5;
      } else {
        niceFraction = 10;
      }
    } else if (fraction <= 1) {
      niceFraction = 1;
    } else if (fraction <= 2) {
      niceFraction = 2;
    } else if (fraction <= 5) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  }

  function formatTick(value) {
    if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
      return value.toExponential(1);
    }
    if (Math.abs(value - Math.round(value)) < 1e-10) {
      return String(Math.round(value));
    }
    return Number(value.toPrecision(6)).toString();
  }

  function formatNumber(value) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return "";
    }
    if (numeric === 0) {
      return "0";
    }
    const absValue = Math.abs(numeric);
    if (absValue >= 100000 || absValue < 1e-4) {
      return numeric.toExponential(6).replace(/\.?0+e/, "e");
    }
    return Number(numeric.toPrecision(8)).toString();
  }

  function toFiniteNumber(value) {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function derivePositiveLowerBound(upper) {
    if (!Number.isFinite(upper) || upper <= 0) {
      return 1e-6;
    }
    return Math.max(Math.min(upper * 1e-6, 1), 1e-12);
  }

  function isNumericLiteral(node, expectedValue) {
    return node && node.type === "number" && Math.abs(node.value - expectedValue) < 1e-12;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  init();
})();
