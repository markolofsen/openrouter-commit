// Mock chalk for Jest tests
const chalk = {
  blue: (str: string) => str,
  red: (str: string) => str,
  green: (str: string) => str,
  yellow: (str: string) => str,
  gray: (str: string) => str,
  grey: (str: string) => str,
  cyan: (str: string) => str,
  white: (str: string) => str,
  magenta: (str: string) => str,
  dim: (str: string) => str,
  bold: (str: string) => str,
  italic: (str: string) => str,
  underline: (str: string) => str,
};

// Add chained methods
Object.keys(chalk).forEach(color => {
  (chalk as any)[color].bold = (str: string) => str;
  (chalk as any)[color].dim = (str: string) => str;
  (chalk as any)[color].italic = (str: string) => str;
  (chalk as any)[color].underline = (str: string) => str;
});

export default chalk;
