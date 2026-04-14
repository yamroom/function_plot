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
  const SETTINGS_VERSION = 2;
  const SUPPORTED_SETTINGS_VERSIONS = new Set([1, SETTINGS_VERSION]);
  const HOVER_DISTANCE_THRESHOLD_PX = 12;
  const TRANSFORM_LIBRARY = Object.freeze({
    derivative: {
      label: "Derivative",
      buildExpression: (sourceExpression) => `d/dx(${sourceExpression})`
    },
    secondDerivative: {
      label: "Second derivative",
      buildExpression: (sourceExpression) => `d^2/dx^2(${sourceExpression})`
    },
    reciprocal: {
      label: "Reciprocal",
      buildExpression: (sourceExpression) => `1/(${sourceExpression})`
    },
    log: {
      label: "Natural log",
      buildExpression: (sourceExpression) => `ln(${sourceExpression})`
    },
    log10: {
      label: "Base-10 log",
      buildExpression: (sourceExpression) => `log10(${sourceExpression})`
    },
    abs: {
      label: "Absolute value",
      buildExpression: (sourceExpression) => `abs(${sourceExpression})`
    },
    square: {
      label: "Square",
      buildExpression: (sourceExpression) => `(${sourceExpression})^2`
    },
    negate: {
      label: "Negate",
      buildExpression: (sourceExpression) => `-(${sourceExpression})`
    },
    sqrt: {
      label: "Square root",
      buildExpression: (sourceExpression) => `sqrt(${sourceExpression})`
    },
    exp: {
      label: "Exponential",
      buildExpression: (sourceExpression) => `exp(${sourceExpression})`
    }
  });

  const state = {
    functions: [
      { id: "fn-1", definition: "f1(x) = 1/beta*ln(1+exp(beta*x))", color: "#d1495b", enabled: true },
      { id: "fn-2", definition: "f2(x) = max(x,0)", color: "#2c7da0", enabled: true },
      { id: "fn-3", definition: "f3(x) = f1(x)*(1/(1-exp(2*x)))", color: "#ef8a17", enabled: true }
    ],
    parameters: [
      { id: "param-beta", name: "beta", value: 5, min: 0.1, max: 50, step: 0.1 }
    ],
    derivedCurves: [],
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
    selectedTransformKey: "derivative",
    selectedTransformTargetId: null,
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
    downloadImageBtn: document.getElementById("downloadImageBtn"),
    functionTransformPanel: document.getElementById("functionTransformPanel"),
    transformTargetSelect: document.getElementById("transformTargetSelect"),
    applyTransformBtn: document.getElementById("applyTransformBtn"),
    derivedCurveList: document.getElementById("derivedCurveList"),
    transformSelectionText: document.getElementById("transformSelectionText"),
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
    dom.downloadImageBtn.addEventListener("click", handleDownloadImage);

    dom.functionList.addEventListener("input", handleFunctionEditorInput);
    dom.functionList.addEventListener("change", handleFunctionEditorInput);
    dom.functionList.addEventListener("click", handleFunctionEditorClick);

    dom.parameterList.addEventListener("input", handleParameterEditorInput);
    dom.parameterList.addEventListener("change", handleParameterEditorInput);
    dom.parameterList.addEventListener("click", handleParameterEditorClick);

    dom.functionTransformPanel.addEventListener("click", handleTransformPanelClick);
    dom.functionTransformPanel.addEventListener("change", handleTransformPanelChange);

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
    renderTransformPanel(compiled);
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
        plotId: `function:${item.id}`,
        kind: "function",
        name: item.name,
        expressionText: `${item.name}(x)`,
        definition: item.definition,
        annotationText: item.definition,
        color: item.color,
        enabled: item.enabled,
        dependencies: item.dependencies || [],
        evaluate: evaluator
      };

      compiledByName[item.name] = evaluator;
      compiledRows.set(item.id, compiled);
    });

    const baseCurves = state.functions
      .map((row) => compiledRows.get(row.id))
      .filter(Boolean);

    const compiledPlotById = new Map();
    baseCurves.forEach((entry) => {
      compiledPlotById.set(entry.plotId, entry);
    });

    const derivedRows = [];
    state.derivedCurves.forEach((row) => {
      const transform = TRANSFORM_LIBRARY[row.transformKey];
      if (!transform) {
        messages.push(makeMessage("error", `Unknown transform "${row.transformKey}".`, row.id));
        return;
      }

      const source = compiledPlotById.get(row.sourcePlotId);
      if (!source) {
        messages.push(makeMessage("error", "The source curve for this derived plot is no longer available.", row.id));
        return;
      }

      const expressionText = transform.buildExpression(source.expressionText);
      const compiled = {
        id: row.id,
        plotId: `derived:${row.id}`,
        kind: "derived",
        name: expressionText,
        expressionText,
        definition: buildDerivedDefinition(source, transform, expressionText),
        annotationText: buildDerivedAnnotationText(source, transform, expressionText),
        color: row.color,
        enabled: row.enabled,
        sourcePlotId: row.sourcePlotId,
        sourceName: source.name,
        transformKey: row.transformKey,
        evaluate: createDerivedEvaluator(row.transformKey, source.evaluate)
      };

      compiledPlotById.set(compiled.plotId, compiled);
      derivedRows.push(compiled);
    });

    const plottedCurves = [...baseCurves, ...derivedRows];
    const activeFunctions = plottedCurves.filter((entry) => entry.enabled);

    return {
      messages,
      parameterMap,
      compiledRows,
      compiledPlotById,
      baseCurves,
      derivedRows,
      plottedCurves,
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
      drawEmptyState("No valid enabled curves are available to plot.", plotRect);
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
    const entries = collectLegendEntries(compiled);
    if (entries.length === 0) {
      dom.legend.innerHTML = '<div class="legend-item"><span>No active curves</span></div>';
      return;
    }

    dom.legend.innerHTML = entries.map((entry) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${escapeHtml(entry.color)}"></span>
        <span>${escapeHtml(entry.name)}</span>
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
    dom.plotStatus.textContent = `${plotOutcome.plottedFunctions} plotted curves | ${samplesText}`;
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

  function handleDownloadImage() {
    if (!state.compiled) {
      refresh({ renderOnly: true });
    }

    const compiled = state.compiled || compileModel();
    const previousHover = state.hover;
    const previousSelection = state.selection;

    state.hover = null;
    state.selection = null;
    refresh({ renderOnly: true });

    try {
      const exportCanvas = renderAnnotatedExportCanvas(compiled);
      const link = document.createElement("a");
      link.href = exportCanvas.toDataURL("image/png");
      link.download = `function-plot-${buildTimestampLabel()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice("info", "PNG image downloaded with curve annotations.");
    } catch (error) {
      setNotice("error", `Could not export image: ${error.message}`);
    } finally {
      state.hover = previousHover;
      state.selection = previousSelection;
      refresh({ renderOnly: true });
    }
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
      derivedCurves: state.derivedCurves.map((row) => ({
        sourceRef: serializeDerivedSourceRef(row.sourcePlotId),
        transformKey: row.transformKey,
        color: row.color,
        enabled: !!row.enabled
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
    if (!SUPPORTED_SETTINGS_VERSIONS.has(raw.version)) {
      throw new Error(`Unsupported settings version "${raw.version ?? ""}".`);
    }
    if (!Array.isArray(raw.functions) || !Array.isArray(raw.parameters)) {
      throw new Error("Settings file is missing the functions or parameters array.");
    }

    const functions = raw.functions.map((entry, index) => validateImportedFunction(entry, index));
    const parameters = raw.parameters.map((entry, index) => validateImportedParameter(entry, index));
    const derivedCurves = Array.isArray(raw.derivedCurves)
      ? raw.derivedCurves.map((entry, index) => validateImportedDerivedCurve(entry, index))
      : [];
    const axis = validateImportedAxis(raw.axis);
    const view = validateImportedView(raw.view);

    return { functions, parameters, derivedCurves, axis, view };
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

  function validateImportedDerivedCurve(entry, index) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Derived curve entry ${index + 1} must be an object.`);
    }
    if (typeof entry.transformKey !== "string" || !TRANSFORM_LIBRARY[entry.transformKey]) {
      throw new Error(`Derived curve entry ${index + 1} has an unknown transform.`);
    }
    if (typeof entry.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(entry.color)) {
      throw new Error(`Derived curve entry ${index + 1} has an invalid color.`);
    }
    if (typeof entry.enabled !== "boolean") {
      throw new Error(`Derived curve entry ${index + 1} must include a boolean enabled flag.`);
    }
    const sourceRef = validateDerivedSourceRef(entry.sourceRef ?? entry.sourcePlotId, index);
    return {
      sourceRef,
      transformKey: entry.transformKey,
      color: entry.color,
      enabled: entry.enabled
    };
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
    const importedDerivedRows = [];
    (snapshot.derivedCurves || []).forEach((entry, index) => {
      const id = buildRowId("derived", index);
      importedDerivedRows.push({
        id,
        sourcePlotId: resolveImportedSourcePlotId(entry.sourceRef, state.functions, importedDerivedRows),
        transformKey: entry.transformKey,
        color: entry.color,
        enabled: entry.enabled
      });
    });
    state.derivedCurves = importedDerivedRows;
    state.axis = { ...snapshot.axis };
    state.view = { ...snapshot.view };
    state.hover = null;
    state.selection = null;
    state.selectedTransformTargetId = null;
    state.selectedTransformKey = "derivative";
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

  function handleTransformPanelClick(event) {
    const transformChip = event.target.closest(".transform-chip");
    if (transformChip) {
      const { transform } = transformChip.dataset;
      if (transform && TRANSFORM_LIBRARY[transform]) {
        state.selectedTransformKey = transform;
        renderTransformPanel(state.compiled || compileModel());
      }
      return;
    }

    if (event.target.closest("#applyTransformBtn")) {
      applySelectedTransform();
      return;
    }

    const removeButton = event.target.closest(".remove-derived");
    if (!removeButton) {
      return;
    }

    const card = event.target.closest(".derived-curve-item");
    if (!card) {
      return;
    }

    const removedPlotId = `derived:${card.dataset.derivedId}`;
    state.derivedCurves = state.derivedCurves.filter((row) => row.id !== card.dataset.derivedId);
    if (state.selectedTransformTargetId === removedPlotId) {
      state.selectedTransformTargetId = null;
    }
    refresh({ autoFitY: false });
  }

  function handleTransformPanelChange(event) {
    if (event.target === dom.transformTargetSelect) {
      state.selectedTransformTargetId = event.target.value || null;
      renderTransformPanel(state.compiled || compileModel());
      return;
    }

    const card = event.target.closest(".derived-curve-item");
    if (!card) {
      return;
    }

    const row = state.derivedCurves.find((entry) => entry.id === card.dataset.derivedId);
    if (!row) {
      return;
    }

    if (event.target.classList.contains("derived-enabled")) {
      row.enabled = event.target.checked;
      refresh({ autoFitY: false });
      return;
    }

    if (event.target.classList.contains("derived-color")) {
      row.color = event.target.value;
      refresh({ autoFitY: false });
    }
  }

  function applySelectedTransform() {
    const compiled = state.compiled || compileModel();
    const targets = compiled.plottedCurves || [];
    const selectedTarget = targets.find((entry) => entry.plotId === state.selectedTransformTargetId) || targets[0];
    const transformKey = state.selectedTransformKey;
    const transform = TRANSFORM_LIBRARY[transformKey];

    if (!selectedTarget || !transform) {
      setNotice("warning", "Select a valid curve and transform before creating a derived plot.");
      refresh({ renderOnly: true });
      return;
    }

    const derivedId = buildRowId("derived", state.derivedCurves.length);
    state.derivedCurves.push({
      id: derivedId,
      sourcePlotId: selectedTarget.plotId,
      transformKey,
      color: deriveCurveColor(selectedTarget.color, state.derivedCurves.length + 1),
      enabled: true
    });
    state.selectedTransformTargetId = `derived:${derivedId}`;
    setNotice("info", `Added ${transform.label.toLowerCase()} curve for ${selectedTarget.name}.`);
    refresh({ autoFitY: false });
  }

  function renderTransformPanel(compiled) {
    const targets = compiled && Array.isArray(compiled.plottedCurves) ? compiled.plottedCurves : [];
    const hasTransforms = targets.length > 0;
    if (!state.selectedTransformKey || !TRANSFORM_LIBRARY[state.selectedTransformKey]) {
      state.selectedTransformKey = "derivative";
    }
    if (!targets.some((entry) => entry.plotId === state.selectedTransformTargetId)) {
      state.selectedTransformTargetId = targets[0] ? targets[0].plotId : null;
    }

    dom.transformTargetSelect.disabled = !hasTransforms;
    dom.transformTargetSelect.innerHTML = hasTransforms
      ? targets.map((entry) => `<option value="${escapeHtml(entry.plotId)}">${escapeHtml(entry.name)}</option>`).join("")
      : '<option value="">No available curve</option>';

    if (hasTransforms && state.selectedTransformTargetId) {
      dom.transformTargetSelect.value = state.selectedTransformTargetId;
    }

    dom.functionTransformPanel.querySelectorAll(".transform-chip").forEach((chip) => {
      const isSelected = chip.dataset.transform === state.selectedTransformKey;
      chip.classList.toggle("is-selected", isSelected);
      chip.disabled = !hasTransforms;
    });

    dom.applyTransformBtn.disabled = !hasTransforms;

    const selectedTarget = targets.find((entry) => entry.plotId === state.selectedTransformTargetId) || null;
    const transform = TRANSFORM_LIBRARY[state.selectedTransformKey];
    if (!selectedTarget || !transform) {
      dom.transformSelectionText.textContent = "Choose a valid curve to enable transforms. Derivative curves use direct finite differences from the underlying evaluator.";
    } else if (state.selectedTransformKey === "derivative" || state.selectedTransformKey === "secondDerivative") {
      dom.transformSelectionText.textContent = `${transform.label} will be applied to ${selectedTarget.name}. This operation is computed from direct function evaluations with symmetric finite differences.`;
    } else {
      dom.transformSelectionText.textContent = `${transform.label} will be applied to ${selectedTarget.name}. The transformed curve is evaluated directly from the source function at every sampled x value.`;
    }

    renderDerivedCurveList(compiled);
  }

  function renderDerivedCurveList(compiled) {
    if (state.derivedCurves.length === 0) {
      dom.derivedCurveList.innerHTML = '<div class="derived-curve-empty">No derived curves yet. Pick a target curve, choose a transform, and apply it to add another plot layer.</div>';
      return;
    }

    const messagesByRow = new Map();
    (compiled ? compiled.messages : []).forEach((message) => {
      if (!message.rowId) {
        return;
      }
      if (!messagesByRow.has(message.rowId)) {
        messagesByRow.set(message.rowId, []);
      }
      messagesByRow.get(message.rowId).push(message);
    });

    const compiledByRowId = new Map();
    (compiled && Array.isArray(compiled.derivedRows) ? compiled.derivedRows : []).forEach((entry) => {
      compiledByRowId.set(entry.id, entry);
    });

    dom.derivedCurveList.innerHTML = state.derivedCurves.map((row) => {
      const compiledRow = compiledByRowId.get(row.id);
      const transform = TRANSFORM_LIBRARY[row.transformKey];
      const rowMessages = messagesByRow.get(row.id) || [];
      const hasError = rowMessages.some((message) => message.level === "error");
      const title = compiledRow ? compiledRow.name : buildFallbackDerivedTitle(row, transform);
      const metaText = compiledRow
        ? compiledRow.annotationText
        : `Source curve: ${describeSourcePlotId(row.sourcePlotId)}.`;

      return `
        <div class="derived-curve-item ${hasError ? "has-error" : ""}" data-derived-id="${row.id}">
          <div class="derived-curve-main">
            <div class="derived-curve-title">
              <span class="legend-swatch" style="background:${escapeHtml(row.color)}"></span>
              <span>${escapeHtml(title)}</span>
            </div>
            <div class="derived-curve-meta">${escapeHtml(metaText)}</div>
            <div class="row-errors">
              ${rowMessages.filter((message) => message.level === "error").map((message) => `<div class="row-error">${escapeHtml(message.text)}</div>`).join("")}
            </div>
          </div>
          <div class="derived-curve-actions">
            <label class="toggle-pill derived-toggle">
              <input class="derived-enabled" type="checkbox" ${row.enabled ? "checked" : ""}>
              <span>Show</span>
            </label>
            <input class="derived-color" type="color" value="${escapeHtml(row.color)}" aria-label="Derived curve color">
            <button class="ghost-button remove-derived" type="button">Remove</button>
          </div>
        </div>
      `;
    }).join("");
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

  function createDerivedEvaluator(transformKey, sourceEvaluate) {
    return function evaluateDerivedCurve(x) {
      return evaluateDerivedValue(transformKey, sourceEvaluate, x);
    };
  }

  function evaluateDerivedValue(transformKey, sourceEvaluate, x) {
    switch (transformKey) {
      case "derivative":
        return evaluateFirstDerivative(sourceEvaluate, x);
      case "secondDerivative":
        return evaluateSecondDerivative(sourceEvaluate, x);
      case "reciprocal": {
        const value = evaluateSourceValue(sourceEvaluate, x);
        return 1 / value;
      }
      case "log":
        return Math.log(evaluateSourceValue(sourceEvaluate, x));
      case "log10":
        return Math.log10(evaluateSourceValue(sourceEvaluate, x));
      case "abs":
        return Math.abs(evaluateSourceValue(sourceEvaluate, x));
      case "square": {
        const value = evaluateSourceValue(sourceEvaluate, x);
        return value * value;
      }
      case "negate":
        return -evaluateSourceValue(sourceEvaluate, x);
      case "sqrt":
        return Math.sqrt(evaluateSourceValue(sourceEvaluate, x));
      case "exp":
        return Math.exp(evaluateSourceValue(sourceEvaluate, x));
      default:
        return Number.NaN;
    }
  }

  function evaluateFirstDerivative(sourceEvaluate, x) {
    const h = estimateTransformStep(x);
    const m2 = evaluateSourceValue(sourceEvaluate, x - 2 * h);
    const m1 = evaluateSourceValue(sourceEvaluate, x - h);
    const p1 = evaluateSourceValue(sourceEvaluate, x + h);
    const p2 = evaluateSourceValue(sourceEvaluate, x + 2 * h);
    if ([m2, m1, p1, p2].every(Number.isFinite)) {
      return (m2 - 8 * m1 + 8 * p1 - p2) / (12 * h);
    }

    if (Number.isFinite(m1) && Number.isFinite(p1)) {
      return (p1 - m1) / (2 * h);
    }

    const center = evaluateSourceValue(sourceEvaluate, x);
    if (Number.isFinite(center) && Number.isFinite(p1)) {
      return (p1 - center) / h;
    }
    if (Number.isFinite(center) && Number.isFinite(m1)) {
      return (center - m1) / h;
    }
    return Number.NaN;
  }

  function evaluateSecondDerivative(sourceEvaluate, x) {
    const h = estimateTransformStep(x);
    const m2 = evaluateSourceValue(sourceEvaluate, x - 2 * h);
    const m1 = evaluateSourceValue(sourceEvaluate, x - h);
    const center = evaluateSourceValue(sourceEvaluate, x);
    const p1 = evaluateSourceValue(sourceEvaluate, x + h);
    const p2 = evaluateSourceValue(sourceEvaluate, x + 2 * h);
    if ([m2, m1, center, p1, p2].every(Number.isFinite)) {
      return (-p2 + 16 * p1 - 30 * center + 16 * m1 - m2) / (12 * h * h);
    }

    if ([m1, center, p1].every(Number.isFinite)) {
      return (p1 - 2 * center + m1) / (h * h);
    }
    return Number.NaN;
  }

  function evaluateSourceValue(sourceEvaluate, x) {
    try {
      return sourceEvaluate(x);
    } catch (error) {
      return Number.NaN;
    }
  }

  function estimateTransformStep(x) {
    const rawMin = toFiniteNumber(state.view.xMin);
    const rawMax = toFiniteNumber(state.view.xMax);
    const span = Number.isFinite(rawMin) && Number.isFinite(rawMax) ? Math.abs(rawMax - rawMin) : Math.max(1, Math.abs(x));
    const baseScale = Math.max(Math.abs(x), 1);
    const stepFloor = state.axis.logX && x > 0 ? x * 1e-6 : 1e-6;
    const step = Math.max(stepFloor, span * 1e-4, baseScale * 1e-6);
    return Math.min(Math.max(step, 1e-7), Math.max(span * 0.05, 1e-4));
  }

  function buildDerivedDefinition(source, transform, expressionText) {
    return `${expressionText}`;
  }

  function buildDerivedAnnotationText(source, transform, expressionText) {
    const sourceText = source.kind === "function" ? source.definition : source.expressionText;
    return `${transform.label} of ${sourceText}`;
  }

  function buildFallbackDerivedTitle(row, transform) {
    if (!transform) {
      return `Derived curve from ${describeSourcePlotId(row.sourcePlotId)}`;
    }
    return transform.buildExpression(describeSourcePlotId(row.sourcePlotId));
  }

  function describeSourcePlotId(sourcePlotId) {
    if (typeof sourcePlotId !== "string") {
      return "unknown curve";
    }
    if (sourcePlotId.startsWith("function:")) {
      return "function curve";
    }
    if (sourcePlotId.startsWith("derived:")) {
      return "derived curve";
    }
    return sourcePlotId;
  }

  function deriveCurveColor(baseColor, offsetIndex) {
    const fallback = COLOR_POOL[offsetIndex % COLOR_POOL.length];
    if (baseColor === fallback) {
      return COLOR_POOL[(offsetIndex + 1) % COLOR_POOL.length];
    }
    return fallback;
  }

  function collectLegendEntries(compiled) {
    return compiled.activeFunctions.map((entry) => ({
      color: entry.color,
      name: entry.name,
      annotationText: entry.annotationText
    }));
  }

  function renderAnnotatedExportCanvas(compiled) {
    const entries = collectLegendEntries(compiled);
    const plotWidth = dom.canvas.width;
    const plotHeight = dom.canvas.height;
    const exportCanvas = document.createElement("canvas");
    const exportCtx = exportCanvas.getContext("2d");
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const padding = 28 * scale;
    const panelGap = 20 * scale;
    const panelPadding = 26 * scale;
    const titleFont = `700 ${30 * scale}px "Aptos", "Segoe UI", sans-serif`;
    const metaFont = `${16 * scale}px "Aptos", "Segoe UI", sans-serif`;
    const nameFont = `700 ${22 * scale}px "Aptos", "Segoe UI", sans-serif`;
    const formulaFont = `${18 * scale}px "Consolas", "Cascadia Mono", "Segoe UI Mono", monospace`;
    const panelWidth = Math.max(360 * scale, Math.round(plotWidth * 0.34));
    const panelContentWidth = panelWidth - panelPadding * 2;
    const rangeLine = buildExportRangeText();
    const panelHeight = measureAnnotationPanelHeight(entries, exportCtx, panelContentWidth, panelPadding, {
      titleFont,
      metaFont,
      nameFont,
      formulaFont,
      scale,
      rangeLine
    });

    exportCanvas.width = plotWidth + panelGap + panelWidth;
    exportCanvas.height = Math.max(plotHeight, panelHeight);

    exportCtx.fillStyle = "#f9f4e8";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(dom.canvas, 0, 0, plotWidth, plotHeight);

    const panelLeft = plotWidth + panelGap;
    const panelTop = 0;
    exportCtx.fillStyle = "rgba(255, 252, 246, 0.98)";
    exportCtx.fillRect(panelLeft, panelTop, panelWidth, exportCanvas.height);
    exportCtx.strokeStyle = "rgba(23, 33, 43, 0.12)";
    exportCtx.lineWidth = 1;
    exportCtx.strokeRect(panelLeft + 0.5, panelTop + 0.5, panelWidth - 1, exportCanvas.height - 1);

    let cursorY = panelTop + panelPadding;
    exportCtx.fillStyle = "#17212b";
    exportCtx.font = titleFont;
    exportCtx.textBaseline = "top";
    exportCtx.fillText("Function Annotations", panelLeft + panelPadding, cursorY);
    cursorY += 38 * scale;

    exportCtx.fillStyle = "#5f6b75";
    exportCtx.font = metaFont;
    const rangeLines = wrapTextToLines(exportCtx, rangeLine, panelContentWidth, metaFont);
    rangeLines.forEach((line) => {
      exportCtx.fillText(line, panelLeft + panelPadding, cursorY);
      cursorY += 22 * scale;
    });
    cursorY += 12 * scale;

    if (entries.length === 0) {
      exportCtx.fillStyle = "#5f6b75";
      exportCtx.fillText("No active curves are currently visible.", panelLeft + panelPadding, cursorY);
      return exportCanvas;
    }

    entries.forEach((entry) => {
      const formulaLines = wrapTextToLines(exportCtx, entry.annotationText, panelContentWidth - 48 * scale, formulaFont);
      const cardHeight = Math.max(96 * scale, 34 * scale + formulaLines.length * 24 * scale + 28 * scale);

      exportCtx.fillStyle = "rgba(255, 255, 255, 0.92)";
      exportCtx.strokeStyle = "rgba(23, 33, 43, 0.1)";
      exportCtx.lineWidth = 1;
      roundRect(exportCtx, panelLeft + panelPadding, cursorY, panelContentWidth, cardHeight, 18 * scale);
      exportCtx.fill();
      exportCtx.stroke();

      const cardLeft = panelLeft + panelPadding + 18 * scale;
      const cardTop = cursorY + 16 * scale;
      exportCtx.fillStyle = entry.color;
      exportCtx.beginPath();
      exportCtx.arc(cardLeft + 8 * scale, cardTop + 12 * scale, 9 * scale, 0, Math.PI * 2);
      exportCtx.fill();

      exportCtx.fillStyle = "#17212b";
      exportCtx.font = nameFont;
      exportCtx.fillText(entry.name, cardLeft + 28 * scale, cardTop);

      exportCtx.fillStyle = "#5f6b75";
      exportCtx.font = formulaFont;
      let formulaY = cardTop + 34 * scale;
      formulaLines.forEach((line) => {
        exportCtx.fillText(line, cardLeft + 28 * scale, formulaY);
        formulaY += 24 * scale;
      });
      cursorY += cardHeight + 14 * scale;
    });

    return exportCanvas;
  }

  function measureAnnotationPanelHeight(entries, exportCtx, panelContentWidth, panelPadding, typography) {
    const { titleFont, metaFont, formulaFont, scale, rangeLine } = typography;
    let height = panelPadding;
    exportCtx.font = titleFont;
    height += 38 * scale;

    const rangeLines = wrapTextToLines(exportCtx, rangeLine, panelContentWidth, metaFont);
    height += rangeLines.length * 22 * scale + 12 * scale;

    if (entries.length === 0) {
      return height + 48 * scale;
    }

    entries.forEach((entry) => {
      const formulaLines = wrapTextToLines(exportCtx, entry.annotationText, panelContentWidth - 48 * scale, formulaFont);
      const cardHeight = Math.max(96 * scale, 34 * scale + formulaLines.length * 24 * scale + 28 * scale);
      height += cardHeight + 14 * scale;
    });

    return height + panelPadding;
  }

  function wrapTextToLines(context, text, maxWidth, font) {
    context.font = font;
    const normalized = String(text);
    if (!normalized.trim()) {
      return [""];
    }

    const lines = [];
    let current = "";
    for (const character of normalized) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) {
      lines.push(current);
    }
    return lines;
  }

  function roundRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  }

  function buildExportRangeText() {
    const xMode = state.axis.logX ? "log x" : "linear x";
    const yMode = state.axis.logY ? "log y" : "linear y";
    return `${xMode} | ${yMode} | x: ${formatNumber(state.view.xMin)} to ${formatNumber(state.view.xMax)} | y: ${formatNumber(state.view.yMin)} to ${formatNumber(state.view.yMax)}`;
  }

  function buildTimestampLabel() {
    const now = new Date();
    const parts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ];
    return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
  }

  function serializeDerivedSourceRef(sourcePlotId) {
    if (typeof sourcePlotId !== "string") {
      throw new Error("A derived curve is missing its source reference.");
    }

    if (sourcePlotId.startsWith("function:")) {
      const sourceId = sourcePlotId.slice("function:".length);
      const index = state.functions.findIndex((row) => row.id === sourceId);
      if (index < 0) {
        throw new Error("A derived curve references a function that no longer exists.");
      }
      return { kind: "function", index };
    }

    if (sourcePlotId.startsWith("derived:")) {
      const sourceId = sourcePlotId.slice("derived:".length);
      const index = state.derivedCurves.findIndex((row) => row.id === sourceId);
      if (index < 0) {
        throw new Error("A derived curve references another derived curve that no longer exists.");
      }
      return { kind: "derived", index };
    }

    throw new Error(`Unsupported derived source reference "${sourcePlotId}".`);
  }

  function validateDerivedSourceRef(raw, index) {
    if (typeof raw === "string" && raw.trim() !== "") {
      return { kind: "legacy", sourcePlotId: raw };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Derived curve entry ${index + 1} is missing a valid sourceRef.`);
    }
    if (!["function", "derived"].includes(raw.kind)) {
      throw new Error(`Derived curve entry ${index + 1} has an invalid sourceRef kind.`);
    }
    const numericIndex = Number(raw.index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) {
      throw new Error(`Derived curve entry ${index + 1} has an invalid sourceRef index.`);
    }
    return { kind: raw.kind, index: numericIndex };
  }

  function resolveImportedSourcePlotId(sourceRef, functions, importedDerivedRows) {
    if (sourceRef.kind === "legacy") {
      return sourceRef.sourcePlotId;
    }
    if (sourceRef.kind === "function") {
      const source = functions[sourceRef.index];
      if (!source) {
        throw new Error("A derived curve references a function index that is missing from the imported file.");
      }
      return `function:${source.id}`;
    }

    const source = importedDerivedRows[sourceRef.index];
    if (!source) {
      throw new Error("A derived curve references a derived curve index that is missing or appears later in the imported file.");
    }
    return `derived:${source.id}`;
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
