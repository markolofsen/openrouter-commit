/**
 * AI thinking phrases - MAXIMUM SARCASM MODE
 * Displayed during commit message generation
 * Brutally honest, cynical, and darkly humorous
 */

export const THINKING_PHRASES = [
  // Brutal Honesty About Code
  "Oh great, another 'temporary' fix...",
  "Analyzing this beautiful disaster...",
  "Wow, someone really copy-pasted their way to victory",
  "Searching for WTF comments... found plenty",
  "Reading code written during 3 AM caffeine psychosis",
  "Decoding hieroglyphics would be easier than this",
  "Someone really said 'YOLO' before committing",
  "Marvel at this architectural... let's call it 'decision'",
  "This code definitely passed the 'works on my machine' test",
  "Analyzing layers of regret and technical debt",

  // Existential Dread
  "Is this code or a cry for help?",
  "Contemplating career choices while parsing this",
  "What would Linus Torvalds say about this?",
  "Questioning the meaning of life.exe",
  "Do bugs cry? Asking for a friend...",
  "Pretending to understand this chaos",
  "Staring into the abyss of nested callbacks",
  "The code stares back, and it's judging me",
  "Wondering if Stack Overflow can help with existential crisis",
  "Lost in the void of legacy code",

  // Git Comedy Gold
  "WIP commits everywhere... shocking",
  "git blame says it was YOU yesterday",
  "Found 47 versions of 'final_FINAL_v3_ACTUAL'",
  "Untangling git spaghetti... again",
  "Time traveling through terrible decisions",
  "Reading commit history like a horror novel",
  "Someone force-pushed to main... absolute legend",
  "Archaeology level: senior developer",
  "Following the trail of 'fix typo' commits",
  "Merge conflict survivor support group",

  // Savage Developer Observations
  "TODO from 2019: 'refactor this later'... sure buddy",
  "console.log debugging at its finest",
  "Variable names by committee, apparently",
  "Ah yes, the sacred art of copying from Stack Overflow",
  "Someone googled 'how to center a div' again",
  "Production debugging disguised as a feature",
  "When copy-paste becomes a lifestyle",
  "Enterprise-grade spaghetti code detected",
  "Someone's learning TypeScript... the hard way",
  "This function has more responsibilities than a CEO",

  // AI Self-Awareness
  "Beep boop, fixing human mistakes again",
  "My circuits hurt from parsing this logic",
  "Training data didn't prepare me for THIS",
  "Even AI has standards... barely",
  "Running on pure sarcasm and algorithms",
  "Calculating the probability of this making sense: 0%",
  "Artificial intelligence, natural judgment",
  "Silicon brain cells dying one at a time",
  "Channeling passive-aggressive programmer energy",
  "This is why machines will inherit the Earth",

  // Maximum Cynicism
  "Another day, another breaking change",
  "Quality code? Never heard of her",
  "Technical debt collector calling...",
  "Agile sprint? More like permanent marathon",
  "Code review? We don't do that here",
  "Best practices left the chat",
  "Documentation? That's a myth, right?",
  "Unit tests as rare as honest politicians",
  "Refactoring scheduled for heat death of universe",
  "Clean code is just a fairy tale",

  // Tabs vs Spaces Wars
  "Mixing tabs and spaces... absolute chaos energy",
  "The holy war continues: tabs vs spaces",
  "Indentation by random number generator",
  "Spaces won the war, tabs still salty",
  "Your IDE must be screaming right now",
  "Prettier is crying somewhere",
  "Format on save? Never heard of it",
  "Indentation more chaotic than my life",
  "Alignment brought to you by chaos theory",
  "EditorConfig has left the building",

  // Naming Nightmares
  "Variable named 'data'... how creative",
  "temp_final_v2_ACTUAL_real... poetry",
  "Function name longer than the function",
  "Someone used single letter variables unironically",
  "myFunction() myFunction2() myFunction3()... genius",
  "foo, bar, baz... the classics never die",
  "Class named Manager managing ManagerManager",
  "Variable names suggest mental breakdown",
  "Hungarian notation in 2025... why",
  "CamelCase, snake_case, SCREAMING_CASE... pick one!",

  // Comments Section
  "// TODO: everything... mood",
  "Comments older than the code they describe",
  "// This shouldn't work but it does",
  "// I have no idea what this does",
  "// Sorry for this code - the prophecy",
  "Found comment: '// HACK: fix later'... narrator: they didn't",
  "// Magic numbers for magic people",
  "Self-documenting code that documents nothing",
  "Comments lying more than politicians",
  "// Will refactor tomorrow... lol",

  // Performance 'Optimization'
  "Optimized for maximum confusion",
  "Performance? Never heard of her",
  "O(n²) complexity because we're fancy",
  "Memory leaks as a service",
  "Caching everything except logic",
  "Big O notation? Big NO notation",
  "Premature optimization is the root of... this mess",
  "Speed: Yes. Quality: Optional",
  "Making computers cry since 1970",
  "Efficiency is overrated anyway",

  // Framework Fatigue
  "Another JavaScript framework was born today",
  "React? Vue? Angular? Yes.",
  "Dependencies downloading the entire internet",
  "node_modules heavier than a black hole",
  "Framework update broke everything... classic",
  "NPM install: buckle up, this'll take a while",
  "Deprecated before it was even finished",
  "Version 0.0.1-alpha-beta-gamma-delta",
  "Breaking changes in minor version... bold move",
  "Framework fatigue reaching critical levels",

  // Reality Check
  "Works on my machine™",
  "Can't reproduce in production... yet",
  "It's not a bug, it's a surprise mechanic",
  "Error 404: good code not found",
  "The tests pass... somewhere, probably",
  "Production is just beta testing with users",
  "Debugging: finding needle in stack of needles",
  "Coffee to code conversion in progress",
  "Rubber duck refused to help",
  "Stack Overflow down? We're doomed",
];

/**
 * Get a random brutally honest thinking phrase
 */
export function getRandomThinkingPhrase(): string {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)] || 'Thinking...';
}
