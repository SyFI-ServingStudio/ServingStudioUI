const colorValue = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const colorProperty =
  /^(?:color|backgroundColor|bgcolor|border(?:Top|Right|Bottom|Left)?Color|outlineColor|textDecorationColor|fill|stroke|fillStyle|strokeStyle|stopColor)$/;
const inherited = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
// CSS named colors, excluding inheritance and transparent/currentColor semantics.
const namedColors = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    ' ',
  ),
);

function name(node) {
  return node?.name ?? node?.value;
}

// Follow only value branches, never object keys, call arguments, or selectors.
function strings(node, check, resolve, seen = new Set()) {
  if (!node || seen.has(node)) return;
  seen.add(node);
  const visit = (value) => strings(value, check, resolve, seen);
  if (node.type === 'Identifier') visit(resolve(node));
  if (node.type === 'Literal' && typeof node.value === 'string') check(node, node.value);
  if (node.type === 'TemplateLiteral') {
    check(node, node.quasis.map((part) => part.value.cooked).join('TOKEN'));
    node.expressions.forEach(visit);
  }
  if (node.type === 'ConditionalExpression') {
    visit(node.consequent);
    visit(node.alternate);
  }
  if (node.type === 'LogicalExpression') {
    visit(node.left);
    visit(node.right);
  }
  if (node.type === 'ArrayExpression') node.elements.forEach((value) => visit(value));
  if (node.type === 'ObjectExpression')
    node.properties.forEach((property) => visit(property.value));
  if (
    node.type === 'JSXExpressionContainer' ||
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression'
  )
    visit(node.expression);
}

export default {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      color: 'Use a shared theme color token (or withAlpha), not a literal color.',
      font: 'Use tokens.body, tokens.mono, tokens.serif, or a derived theme font.',
    },
  },
  create(context) {
    const reported = new Set();
    function report(node, messageId) {
      if (!reported.has(node)) {
        reported.add(node);
        context.report({ node, messageId });
      }
    }
    function resolve(node) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          const definition = variable.defs[0];
          return definition?.parent?.kind === 'const' ? definition.node.init : undefined;
        }
        scope = scope.upper;
      }
    }
    function property(key, value) {
      key =
        typeof key === 'string'
          ? key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
          : key;
      if (key === 'fontFamily' || key === 'font-family' || key === 'font') {
        strings(
          value,
          (node, text) => {
            const family = text.replace(/var\(--[\w-]+\)/g, 'TOKEN');
            const dynamicFont =
              key === 'font' &&
              !family.replace(/TOKEN|[\d.]+|px|rem|em|%|normal|bold|italic|\s|\//g, '');
            if (!inherited.has(text) && family !== 'TOKEN' && !dynamicFont) report(node, 'font');
          },
          resolve,
        );
      }
      if (
        colorProperty.test(key) ||
        /^(?:background|border(?:Top|Right|Bottom|Left)?|outline|boxShadow|textShadow)$/.test(key)
      ) {
        strings(
          value,
          (node, text) => {
            const literal = text
              .replace(/var\(--[\w-]+\)|url\([^)]*\)/g, '')
              .replace(/[\w-]+\.[\w.-]+/g, '');
            if (
              colorValue.test(literal) ||
              literal.split(/[\s,()]+/).some((word) => namedColors.has(word.toLowerCase()))
            )
              report(node, 'color');
          },
          resolve,
        );
      }
    }
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          ['withAlpha', 'mixColor'].includes(node.callee.name)
        ) {
          node.arguments
            .slice(0, node.callee.name === 'mixColor' ? 2 : 1)
            .forEach((argument) => property('color', argument));
        }
      },
      Property(node) {
        if (!node.computed || node.key.type === 'Literal') property(name(node.key), node.value);
      },
      JSXAttribute(node) {
        property(name(node.name), node.value);
      },
      AssignmentExpression(node) {
        if (
          node.left.type === 'MemberExpression' &&
          (!node.left.computed || node.left.property.type === 'Literal')
        )
          property(name(node.left.property), node.right);
      },
    };
  },
};
