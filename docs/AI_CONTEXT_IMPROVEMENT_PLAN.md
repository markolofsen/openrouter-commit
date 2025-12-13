# AI Context Improvement Plan

**Дата:** 2025-12-13
**Статус:** В разработке
**Приоритет:** Критический

## 📋 Содержание

1. [Анализ проблемы](#анализ-проблемы)
2. [Корневые причины](#корневые-причины)
3. [Предложенное решение](#предложенное-решение)
4. [План реализации](#план-реализации)
5. [Технические детали](#технические-детали)
6. [Тестирование](#тестирование)

---

## 🔍 Анализ проблемы

### Симптомы

**Проблема 1: Некорректные commit messages**
```
Ситуация: Коммит с 465 файлами
AI предложил: "refactor(authentication): migrate from session-based to JWT authentication"
Реальность: Изменения не связаны с JWT/auth вообще
```

**Проблема 2: "No relevant changes found"**
```
Ситуация: Коммит с 2 файлами (Makefile, package.json)
Результат: "All changes were filtered out"
Реальность: Изменения были важными, но отфильтровались
```

### Наблюдения

1. AI генерирует commit messages на основе **частичного контекста**
2. Большие коммиты фильтруются агрессивно
3. AI "догадывается" о содержимом вместо анализа реальных изменений
4. Система теряет 90-95% контекста из-за множественных фильтров

---

## 🚨 Корневые причины

### Критическая проблема #1: Жесткий лимит 20 строк

**Файл:** `src/modules/core.ts:637`

```typescript
const relevantLines = chunk.lines
  .filter(line => line.type === 'added' || line.type === 'removed')
  .slice(0, 20) // ❌ КРИТИЧНО: AI видит только первые 20 строк из каждого chunk!
  .map(line => `${line.type === 'added' ? '+' : '-'}${line.content}`)
  .join('\n');
```

**Последствия:**
- Файл с 500 изменениями → AI видит только 20 первых строк
- Теряется 96% контекста (480 строк из 500)
- AI не может понять полную картину изменений
- Генерируются неточные commit messages

**Пример:**
```
Реальный файл:
  Lines 1-20:   import statements, setup
  Lines 21-500: реальная логика, новые функции, bug fixes

AI видит:
  Lines 1-20:   import statements, setup
  Lines 21-500: ❌ НЕВИДИМО

Результат: AI думает что это "refactor imports"
```

---

### Критическая проблема #2: Агрессивная фильтрация

**Файл:** `src/modules/diff-filter.ts:209-212`

```typescript
const relevantFiles = scoredFiles
  .filter(scored => scored.score >= opts.relevancyThreshold) // threshold = 0.1
  .sort((a, b) => b.score - a.score)
```

**Система оценки:**
- Базовый score: 0.1 (за сам факт изменений)
- Тип файла: +0.1-0.4 (source code лучше, docs хуже)
- Паттерны кода: +0.2-0.3 (функции, error handling, etc.)
- Штраф за размер: ×0.7 для файлов >500 строк

**Проблемы:**
1. **Threshold = 0.1 слишком высокий** для некоторых типов файлов
   ```
   Makefile: base(0.1) + type(0) = 0.1 → на грани отсечения
   package.json: base(0.1) + type(0.25) = 0.35 → проходит
   docs/README.md: base(0.1) + type(0.15) = 0.25 → проходит

   Но если файл еще и большой (>500 строк):
   Makefile (600 строк): 0.1 × 0.7 = 0.07 → ❌ ОТФИЛЬТРОВАН!
   ```

2. **Hardcoded паттерны не покрывают все случаи**
   ```typescript
   // Эти паттерны получают бонусы:
   /function|def|class|interface/  // +0.3
   /error|exception|catch|throw/   // +0.2
   /password|token|key|auth/       // +0.2

   // Но что если изменения в:
   - Business logic без новых функций?
   - Refactoring существующего кода?
   - Configuration changes?
   → Могут не набрать достаточно баллов!
   ```

3. **Фильтрация "formatter noise" слишком агрессивна**
   ```typescript
   // Эти строки отфильтровываются:
   /^import\s+/          // Все imports
   /^from\s+.*import/    // Все from-imports
   /,\s*$/               // Trailing commas
   /;\s*$/               // Semicolons
   /^["']/               // Quote changes

   // Проблема: иногда import changes важны!
   // Например: добавление новой зависимости
   import { newFeature } from 'new-library'; // ❌ отфильтровано как noise
   ```

**Последствия:**
- Важные файлы отфильтровываются
- AI не видит конфигурационные изменения
- Теряется контекст зависимостей

---

### Проблема #3: Отсутствие контекста проекта

**Что отсутствует:**
1. **История коммитов** - AI не знает что происходило ранее
2. **Стиль проекта** - AI не знает принятый формат commit messages
3. **Связь между изменениями** - AI не понимает как файлы связаны

**Пример:**
```
История коммитов:
  abc123 feat: add JWT authentication endpoint
  def456 feat: implement token refresh logic
  ghi789 refactor: move auth to separate service

Текущий коммит:
  - Update auth tests
  - Fix token expiration bug

AI без контекста думает:
  "fix: update tests"

AI с контекстом понял бы:
  "fix(auth): fix token expiration in JWT refresh flow"
```

---

### Проблема #4: Жесткие параметры без возможности настройки

**Текущие hardcoded значения:**
```typescript
// diff-filter.ts
relevancyThreshold: 0.1,        // Нельзя изменить
maxFileSize: 1024 * 1024,       // 1MB - нельзя изменить

// core.ts
.slice(0, 20)                   // Нельзя изменить
maxChunkSize: 100000,           // Нельзя изменить
```

**Проблемы:**
- Разные проекты требуют разных настроек
- Невозможно адаптировать под специфику репозитория
- Пользователь не может контролировать процесс

---

## 💡 Предложенное решение

### Гибридный двухэтапный подход с AI File Selection

```
┌─────────────────────────────────────────────────────────┐
│  ЭТАП 0: Быстрая эвристическая фильтрация               │
│  ├─ Убрать binary files                                 │
│  ├─ Убрать lock files                                   │
│  ├─ Убрать node_modules, vendor, etc.                   │
│  └─ Убрать очевидно generated код                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  УСЛОВИЕ: Сколько файлов?                               │
│  ├─ < 20 файлов:  → Пропустить AI selection            │
│  ├─ 20-150 файлов: → ЭТАП 1 (AI selection)             │
│  └─ > 150 файлов:  → Улучшенная эвристика              │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  ЭТАП 1: AI File Selection (только для 20-150 файлов)  │
│  ├─ Создать preview каждого файла:                     │
│  │   • Path, status, size, language                    │
│  │   • First 30-50 lines of changes (адаптивно)        │
│  │   • Priority level (high/medium/low)                │
│  ├─ Отправить в AI (быструю модель, например Haiku)    │
│  └─ AI выбирает TOP-N самых важных файлов              │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  ЭТАП 2: Полный анализ с улучшениями                   │
│  ├─ Адаптивный лимит строк (не 20, а 50-200!)         │
│  ├─ Добавить git history (последние 5 коммитов)       │
│  ├─ Добавить контекст проекта                          │
│  └─ Генерация commit message                           │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 План реализации

### Phase 1: Критичные исправления (День 1)

**Цель:** Немедленно улучшить качество без breaking changes

**Задачи:**

1. **Убрать жесткий лимит 20 строк**
   - Файл: `src/modules/core.ts:637`
   - Было: `.slice(0, 20)`
   - Станет: `.slice(0, this.getAdaptiveLineLimit(file, totalFiles))`

   ```typescript
   private getAdaptiveLineLimit(file: GitFile, totalFiles: number): number {
     if (totalFiles <= 5) return 200;   // Малый коммит - показать все
     if (totalFiles <= 20) return 100;  // Средний - 100 строк
     if (totalFiles <= 50) return 50;   // Большой - 50 строк
     return 30;                          // Огромный - минимум 30
   }
   ```

2. **Понизить relevancy threshold**
   - Файл: `src/modules/core.ts:118`, `src/modules/diff-filter.ts:26`
   - Было: `relevancyThreshold: 0.1`
   - Станет: `relevancyThreshold: 0.05`

3. **Добавить quickFilter для базовой очистки**
   - Файл: `src/modules/diff-filter.ts`
   - Новый метод: `quickFilter(files: GitFile[]): GitFile[]`
   - Убирает только очевидный мусор (binary, locks, node_modules)

**Ожидаемый результат:**
- AI будет видеть в 2-10 раз больше контекста
- Меньше ложных срабатываний фильтра
- Работает сразу без изменений конфигурации

---

### Phase 2: AI File Selector (Дни 2-3)

**Цель:** Интеллектуальный выбор файлов для анализа

**Структура:**

```typescript
// src/modules/file-selector.ts

interface FilePreview {
  path: string;
  status: GitFileStatus;
  size: number;              // lines changed
  language: string;          // detected language
  priority: 'high' | 'medium' | 'low';
  preview: string;           // first N lines of changes
}

interface AIFileSelectionResult {
  selectedFiles: string[];   // paths
  reasoning?: string;        // опционально: почему выбраны
  confidence: number;        // 0-1: уверенность AI
}

class AIFileSelector {
  constructor(private config: Config) {}

  /**
   * Main entry point for file selection
   */
  async selectRelevantFiles(
    files: GitFile[],
    maxFiles: number = 30
  ): Promise<GitFile[]> {

    // 1. Quick filter
    const filtered = this.quickFilter(files);

    // 2. Decide if AI selection needed
    if (filtered.length <= 20) {
      return filtered; // Too few files - use all
    }

    if (filtered.length > 150) {
      return this.heuristicSelection(filtered, maxFiles);
    }

    // 3. AI selection for 20-150 files
    const previews = this.createPreviews(filtered);
    const result = await this.askAI(previews, maxFiles);

    return files.filter(f => result.selectedFiles.includes(f.path));
  }

  /**
   * Remove obvious non-code files
   */
  private quickFilter(files: GitFile[]): GitFile[] {
    return files.filter(file => {
      // Binary files
      if (file.isBinary) return false;

      // Lock files
      if (/\.(lock|sum)$/.test(file.path)) return false;

      // Package manager directories
      if (/node_modules|vendor|bower_components/.test(file.path)) {
        return false;
      }

      // Build outputs
      if (/dist\/|build\/|out\/|\.next\/|\.nuxt\//.test(file.path)) {
        return false;
      }

      // Cache and temp
      if (/\.cache\/|tmp\/|temp\//.test(file.path)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create file previews with smart sizing
   */
  private createPreviews(files: GitFile[]): FilePreview[] {
    return files.map(file => {
      const priority = this.calculatePriority(file);
      const changedLines = this.getChangedLines(file);

      // Adaptive preview size based on priority
      const previewSize = priority === 'high' ? 50 :
                          priority === 'medium' ? 30 : 20;

      return {
        path: file.path,
        status: file.status,
        size: changedLines.length,
        language: this.detectLanguage(file.path),
        priority,
        preview: changedLines.slice(0, previewSize).join('\n')
      };
    });
  }

  /**
   * Calculate file priority
   */
  private calculatePriority(file: GitFile): 'high' | 'medium' | 'low' {
    const path = file.path.toLowerCase();

    // High priority: source code
    if (/\.(ts|tsx|js|jsx|py|rb|php|java|go|rs|cpp|c|h)$/.test(path)) {
      return 'high';
    }

    // Medium priority: configs, schemas
    if (/\.(json|yaml|yml|toml|sql|graphql|prisma)$/.test(path)) {
      return 'medium';
    }

    // Low priority: docs, styles
    if (/\.(md|txt|css|scss|html)$/.test(path)) {
      return 'low';
    }

    return 'medium'; // default
  }

  /**
   * Get all changed lines from file
   */
  private getChangedLines(file: GitFile): string[] {
    const lines: string[] = [];

    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        if (line.type === 'added' || line.type === 'removed') {
          const prefix = line.type === 'added' ? '+' : '-';
          lines.push(`${prefix} ${line.content}`);
        }
      }
    }

    return lines;
  }

  /**
   * Detect programming language
   */
  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();

    const langMap: Record<string, string> = {
      'ts': 'TypeScript',
      'tsx': 'TypeScript React',
      'js': 'JavaScript',
      'jsx': 'JavaScript React',
      'py': 'Python',
      'rb': 'Ruby',
      'php': 'PHP',
      'java': 'Java',
      'go': 'Go',
      'rs': 'Rust',
      'cpp': 'C++',
      'c': 'C',
      'cs': 'C#',
      'sql': 'SQL',
      'graphql': 'GraphQL',
    };

    return ext ? (langMap[ext] || ext.toUpperCase()) : 'Unknown';
  }

  /**
   * Ask AI to select files
   */
  private async askAI(
    previews: FilePreview[],
    maxFiles: number
  ): Promise<AIFileSelectionResult> {

    const prompt = this.buildSelectionPrompt(previews, maxFiles);

    try {
      const response = await apiManager.generateCommitMessage({
        provider: this.config.preferences.defaultProvider,
        model: this.getSelectionModel(),
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.3, // Low temperature for consistent selection
      }, this.config.preferences.defaultProvider);

      if (!response.success || !response.data) {
        throw new Error('AI selection failed');
      }

      return this.parseAIResponse(response.data);

    } catch (error) {
      logger.warn('AI file selection failed, falling back to heuristic');
      return {
        selectedFiles: this.heuristicSelection(
          previews.map(p => ({ path: p.path }) as GitFile),
          maxFiles
        ).map(f => f.path),
        confidence: 0.5,
      };
    }
  }

  /**
   * Build prompt for AI file selection
   */
  private buildSelectionPrompt(
    previews: FilePreview[],
    maxFiles: number
  ): string {

    const filesList = previews.map((p, i) => `
[${i + 1}] ${p.path}
   Status: ${p.status} | Size: ${p.size} lines | Language: ${p.language} | Priority: ${p.priority}
   Preview:
${p.preview.split('\n').map(l => '   ' + l).join('\n')}
---`).join('\n');

    return `You are analyzing a git commit with ${previews.length} changed files.

YOUR TASK: Select the TOP ${maxFiles} most important files needed to write an accurate, comprehensive commit message.

SELECTION CRITERIA:
1. **Core changes**: Files that represent the main purpose of this commit
2. **Source code priority**: Prefer actual code over configs/docs (unless config IS the main change)
3. **Avoid redundancy**: If 10 test files test the same feature, pick 2-3 representative ones
4. **Context matters**: Include files that provide context for understanding the changes
5. **Watch for patterns**:
   - New files (added) are often important
   - Deleted files may indicate major refactoring
   - Modified core modules are usually critical

FILES TO ANALYZE:
${filesList}

RESPONSE FORMAT (JSON only):
{
  "selectedFiles": ["path/to/file1.ts", "path/to/file2.ts", ...],
  "reasoning": "Brief explanation of selection strategy",
  "confidence": 0.85
}

Return ONLY valid JSON, no markdown, no explanations outside JSON.`;
  }

  /**
   * Parse AI response
   */
  private parseAIResponse(response: string): AIFileSelectionResult {
    try {
      // Remove markdown code blocks if present
      let cleaned = response.trim();
      const match = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (match) {
        cleaned = match[1] || cleaned;
      }

      const parsed = JSON.parse(cleaned);

      return {
        selectedFiles: parsed.selectedFiles || [],
        reasoning: parsed.reasoning,
        confidence: parsed.confidence || 0.5,
      };

    } catch (error) {
      logger.error('Failed to parse AI selection response', error as Error);
      throw new Error('Invalid AI response format');
    }
  }

  /**
   * Fallback heuristic selection
   */
  private heuristicSelection(files: GitFile[], maxFiles: number): GitFile[] {
    // Sort by priority: source code > configs > docs
    const scored = files.map(file => ({
      file,
      score: this.calculateFileScore(file),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxFiles).map(s => s.file);
  }

  /**
   * Calculate simple numeric score for heuristic sorting
   */
  private calculateFileScore(file: GitFile): number {
    let score = 0;
    const path = file.path.toLowerCase();

    // Priority by file type
    if (/\.(ts|tsx|js|jsx|py|rb|java|go)$/.test(path)) {
      score += 100; // Source code
    } else if (/\.(json|yaml|yml|toml)$/.test(path)) {
      score += 50; // Config
    } else if (/\.(md|txt)$/.test(path)) {
      score += 20; // Docs
    }

    // Boost for new/deleted files
    if (file.status === 'added') score += 30;
    if (file.status === 'deleted') score += 20;

    // Boost for core directories
    if (/^src\//.test(path)) score += 20;
    if (/^lib\//.test(path)) score += 15;

    // Penalize test files (unless that's the main change)
    if (/\.(test|spec)\.(ts|js|py)$/.test(path)) score -= 10;

    return score;
  }

  /**
   * Get model for file selection (cheaper, faster model)
   */
  private getSelectionModel(): string {
    const provider = this.config.preferences.defaultProvider;

    // Use cheaper models for file selection
    if (provider === 'openrouter') {
      return 'anthropic/claude-3-haiku:beta';
    } else {
      return 'gpt-3.5-turbo';
    }
  }
}

export const fileSelector = new AIFileSelector(configManager.getConfig());
```

**Интеграция в core.ts:**

```typescript
// src/modules/core.ts

async generateCommit(options: CliOptions): Promise<void> {
  // ... existing code ...

  // Phase 2: Filter and process
  const filterProgress = contextualLogger.startProgress('Processing changes');

  // Quick filter first
  let diff = diffFilter.quickFilter(rawDiff);
  filterProgress.update(`Quick filter: ${diff.files.length} files remaining`);

  // AI file selection if needed
  if (this.shouldUseAISelection(diff.files.length)) {
    filterProgress.update('AI analyzing file relevance...');

    const maxFiles = options.maxFiles || this.config.generation.maxFilesForAnalysis;
    diff.files = await fileSelector.selectRelevantFiles(diff.files, maxFiles);

    filterProgress.succeed(`AI selected ${diff.files.length} most relevant files`);
  } else {
    // Traditional filtering for small/large commits
    diff = diffFilter.filterDiff(diff, {
      ignoreGenerated: options.ignoreGenerated,
      ignoreWhitespace: options.ignoreWhitespace,
      relevancyThreshold: this.config.generation.relevancyThreshold,
    });

    filterProgress.succeed(`Filtered to ${diff.files.length} relevant files`);
  }

  // ... rest of the code ...
}

private shouldUseAISelection(fileCount: number): boolean {
  if (!this.config.generation.enableAIFileSelection) {
    return false;
  }

  const threshold = this.config.generation.aiSelectionThreshold;
  const maxForAI = 150; // Don't use AI for huge commits (too slow)

  return fileCount >= threshold && fileCount <= maxForAI;
}
```

---

### Phase 3: Git Context (День 4)

**Цель:** Добавить исторический контекст для лучшего понимания

**Реализация:**

```typescript
// src/modules/git.ts

/**
 * Get recent commit history for context
 */
async getCommitHistory(depth: number = 5): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git log -${depth} --oneline --no-decorate`,
      EXEC_OPTIONS
    );

    return stdout
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0);

  } catch (error) {
    logger.warn('Failed to get commit history', error as Error);
    return [];
  }
}

/**
 * Get current branch name
 */
async getCurrentBranch(): Promise<string> {
  // ... existing code ...
}

/**
 * Format git context for AI
 */
async getGitContextForAI(): Promise<string> {
  const history = await this.getCommitHistory(5);
  const branch = await this.getCurrentBranch();

  if (history.length === 0) {
    return '';
  }

  return `
[GIT_CONTEXT]
Current branch: ${branch}

Recent commits (for context and style reference):
${history.map((line, i) => `${i + 1}. ${line}`).join('\n')}

Note: Use similar commit message style as above.
[/GIT_CONTEXT]
`;
}
```

**Интеграция в core.ts:**

```typescript
// src/modules/core.ts

private async generateCommitMessage(
  diff: GitDiff,
  options: CliOptions,
  provider: 'openrouter' | 'openai',
  userFeedback?: string
): Promise<{ commitMessage: string; assessment: string | null }> {

  // ... existing code ...

  // Prepare diff content
  const rawDiffContent = this.prepareDiffContent(diff);
  let diffContent = wrapDiffContent(rawDiffContent);

  // Add git context if enabled
  if (this.config.generation.includeGitHistory) {
    const gitContext = await gitManager.getGitContextForAI();
    if (gitContext) {
      diffContent = gitContext + '\n\n' + diffContent;
    }
  }

  // ... rest of the code ...
}
```

---

### Phase 4: Configuration (День 5)

**Цель:** Дать пользователю контроль над всеми параметрами

**Обновление типов:**

```typescript
// src/types/index.ts

export interface CommitGenerationConfig {
  // AI File Selection
  enableAIFileSelection: boolean;      // default: true
  aiSelectionThreshold: number;        // files count to trigger (default: 20)
  maxFilesForAnalysis: number;         // max files to analyze (default: 30)

  // Line limits
  maxLinesPerChunk: number;            // default: 100 (was 20!)
  adaptiveLineLimits: boolean;         // default: true
  smallCommitLineLimit: number;        // default: 200 (for <=5 files)
  mediumCommitLineLimit: number;       // default: 100 (for <=20 files)
  largeCommitLineLimit: number;        // default: 50 (for <=50 files)
  hugeCommitLineLimit: number;         // default: 30 (for >50 files)

  // Git context
  includeGitHistory: boolean;          // default: true
  gitHistoryDepth: number;             // default: 5 commits

  // Filtering
  relevancyThreshold: number;          // default: 0.05 (was 0.1)
  aggressiveFilteringThreshold: number; // files count (default: 100)

  // Performance
  maxConcurrentRequests: number;       // default: 3
  enableCaching: boolean;              // default: true
}

export interface Config {
  version: string;
  providers: {
    openrouter: ProviderConfig;
    openai: ProviderConfig;
  };
  preferences: PreferencesConfig;
  generation: CommitGenerationConfig;  // NEW!
}
```

**Defaults:**

```typescript
// src/modules/config.ts

const DEFAULT_GENERATION_CONFIG: CommitGenerationConfig = {
  // AI File Selection
  enableAIFileSelection: true,
  aiSelectionThreshold: 20,
  maxFilesForAnalysis: 30,

  // Line limits
  maxLinesPerChunk: 100,
  adaptiveLineLimits: true,
  smallCommitLineLimit: 200,
  mediumCommitLineLimit: 100,
  largeCommitLineLimit: 50,
  hugeCommitLineLimit: 30,

  // Git context
  includeGitHistory: true,
  gitHistoryDepth: 5,

  // Filtering
  relevancyThreshold: 0.05,
  aggressiveFilteringThreshold: 100,

  // Performance
  maxConcurrentRequests: 3,
  enableCaching: true,
};
```

**CLI Commands:**

```typescript
// src/cli.ts

// New commands for generation config
program
  .command('config:generation')
  .description('Configure commit generation settings')
  .action(async () => {
    // Interactive prompts to configure generation settings
  });

program
  .command('config:generation:reset')
  .description('Reset generation settings to defaults')
  .action(async () => {
    await configManager.resetGenerationConfig();
  });

program
  .command('config:generation:show')
  .description('Show current generation settings')
  .action(async () => {
    const config = await configManager.load();
    console.log(config.generation);
  });
```

---

### Phase 5: Testing & Validation (Дни 6-7)

**Test Cases:**

```typescript
// tests/file-selector.test.ts

describe('AIFileSelector', () => {

  test('should use all files for small commits (<20)', async () => {
    const files = generateMockFiles(10);
    const result = await fileSelector.selectRelevantFiles(files);
    expect(result.length).toBe(10);
  });

  test('should use AI selection for medium commits (20-150)', async () => {
    const files = generateMockFiles(50);
    const result = await fileSelector.selectRelevantFiles(files, 30);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  test('should use heuristic for large commits (>150)', async () => {
    const files = generateMockFiles(200);
    const result = await fileSelector.selectRelevantFiles(files, 30);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  test('quickFilter should remove binary files', () => {
    const files = [
      { path: 'src/index.ts', isBinary: false },
      { path: 'image.png', isBinary: true },
    ];
    const result = fileSelector.quickFilter(files);
    expect(result.length).toBe(1);
    expect(result[0].path).toBe('src/index.ts');
  });

  test('should calculate correct priority', () => {
    expect(fileSelector.calculatePriority({ path: 'src/main.ts' })).toBe('high');
    expect(fileSelector.calculatePriority({ path: 'config.json' })).toBe('medium');
    expect(fileSelector.calculatePriority({ path: 'README.md' })).toBe('low');
  });

});
```

```typescript
// tests/adaptive-limits.test.ts

describe('Adaptive Line Limits', () => {

  test('small commit should use high limit', () => {
    const limit = core.getAdaptiveLineLimit(mockFile, 5);
    expect(limit).toBe(200);
  });

  test('medium commit should use medium limit', () => {
    const limit = core.getAdaptiveLineLimit(mockFile, 20);
    expect(limit).toBe(100);
  });

  test('large commit should use low limit', () => {
    const limit = core.getAdaptiveLineLimit(mockFile, 100);
    expect(limit).toBe(30);
  });

});
```

**Integration Tests:**

```bash
# Test scenarios

# Scenario 1: Small commit (2 files)
git add Makefile package.json
orc commit
# Expected: Use all files, no filtering, high line limit

# Scenario 2: Medium commit (30 files)
git add src/**/*.ts
orc commit
# Expected: AI file selection, select ~20-30 files, medium line limit

# Scenario 3: Large commit (100+ files)
git add .
orc commit
# Expected: Heuristic filtering, top 30-50 files, low line limit

# Scenario 4: With git context
orc commit --include-history
# Expected: Git history included in prompt

# Scenario 5: Disable AI selection
orc config:generation set enableAIFileSelection false
orc commit
# Expected: Use traditional filtering only
```

---

## 📊 Ожидаемые улучшения

### Метрики качества:

**До изменений:**
```
Тест 1: 465 файлов
  Context seen by AI: ~2,000 lines (5% из 40,000)
  Result: "refactor(authentication): migrate to JWT" ❌ Неверно

Тест 2: 2 файла (Makefile, package.json)
  Context seen by AI: 0 lines (отфильтровано)
  Result: "No relevant changes found" ❌ Неверно
```

**После изменений:**
```
Тест 1: 465 файлов
  Quick filter: 465 → 300 files
  Heuristic: 300 → 50 top files
  Context seen by AI: ~5,000 lines (100 per file × 50)
  Result: Accurate commit message based on real changes ✅

Тест 2: 2 файла
  Quick filter: 2 files (pass through)
  No AI selection needed
  Context seen by AI: ~400 lines (200 per file)
  Result: Accurate commit message ✅
```

### Performance:

**Текущий:**
```
Small commit (5 files):   ~5 seconds
Medium commit (30 files): ~8 seconds
Large commit (100 files): ~15 seconds (часто неточный)
```

**Ожидаемый:**
```
Small commit (5 files):   ~5 seconds (без изменений)
Medium commit (30 files): ~12 seconds (+4s за AI selection, но точнее!)
Large commit (100 files): ~10 seconds (быстрее за счет лучшей фильтрации)
```

### Стоимость:

**Дополнительные затраты на AI File Selection:**
```
Модель: Claude Haiku / GPT-3.5 Turbo (дешевые)
Tokens per request: ~2,000-4,000 (previews)
Cost per request: ~$0.001-0.002
Frequency: Только для коммитов 20-150 файлов (~30% случаев)

Средний рост стоимости: ~$0.002 per commit (с AI selection)
Benefit: Значительно более точные commit messages
```

---

## 🎛️ Конфигурация

### Файл конфигурации:

**~/.orc/config.json:**
```json
{
  "version": "2.0.0",
  "providers": { ... },
  "preferences": { ... },
  "generation": {
    "enableAIFileSelection": true,
    "aiSelectionThreshold": 20,
    "maxFilesForAnalysis": 30,
    "maxLinesPerChunk": 100,
    "adaptiveLineLimits": true,
    "smallCommitLineLimit": 200,
    "mediumCommitLineLimit": 100,
    "largeCommitLineLimit": 50,
    "hugeCommitLineLimit": 30,
    "includeGitHistory": true,
    "gitHistoryDepth": 5,
    "relevancyThreshold": 0.05,
    "aggressiveFilteringThreshold": 100,
    "maxConcurrentRequests": 3,
    "enableCaching": true
  }
}
```

### CLI управление:

```bash
# Показать текущие настройки генерации
orc config:generation:show

# Настроить интерактивно
orc config:generation

# Установить конкретное значение
orc config:generation set enableAIFileSelection true
orc config:generation set maxFilesForAnalysis 50
orc config:generation set includeGitHistory true

# Сбросить к defaults
orc config:generation:reset

# Disable AI selection (faster, but less accurate)
orc config:generation set enableAIFileSelection false
```

---

## 🔄 Migration Path

### Обратная совместимость:

1. **Старые конфиги работают** - если `generation` секции нет, используются defaults
2. **Постепенное включение** - можно disable AI selection если не нужна
3. **Fallback на heuristic** - если AI selection fails, используется эвристика

### Migration guide:

```bash
# 1. Upgrade
npm install -g openrouter-commit@latest

# 2. Config автоматически обновится при первом запуске
orc commit

# 3. (Опционально) Настроить под себя
orc config:generation

# 4. (Опционально) Disable AI selection если хотите старое поведение
orc config:generation set enableAIFileSelection false
```

---

## 📝 Чеклист выполнения

### Phase 1: Critical Fixes ✅
- [ ] Убрать `.slice(0, 20)` из `core.ts:637`
- [ ] Добавить `getAdaptiveLineLimit()` метод
- [ ] Понизить `relevancyThreshold` с 0.1 до 0.05
- [ ] Добавить `quickFilter()` в `diff-filter.ts`
- [ ] Unit tests для adaptive limits
- [ ] Integration test на разных размерах коммитов

### Phase 2: AI File Selector ✅
- [ ] Создать `src/modules/file-selector.ts`
- [ ] Реализовать `AIFileSelector` класс
- [ ] Реализовать `quickFilter()`
- [ ] Реализовать `createPreviews()`
- [ ] Реализовать `askAI()` с JSON парсингом
- [ ] Реализовать `heuristicSelection()` fallback
- [ ] Интегрировать в `core.ts`
- [ ] Добавить `shouldUseAISelection()` логику
- [ ] Unit tests для всех методов
- [ ] Integration tests на разных сценариях
- [ ] Обработка ошибок и fallback

### Phase 3: Git Context ✅
- [ ] Добавить `getCommitHistory()` в `git.ts`
- [ ] Добавить `getGitContextForAI()` метод
- [ ] Интегрировать в `generateCommitMessage()`
- [ ] Форматирование для AI промпта
- [ ] Tests для git context
- [ ] Fallback если git history недоступна

### Phase 4: Configuration ✅
- [ ] Обновить `types/index.ts` с `CommitGenerationConfig`
- [ ] Добавить defaults в `config.ts`
- [ ] Реализовать `config:generation` CLI команды
- [ ] Migration existing configs
- [ ] Validation для config values
- [ ] Documentation в README

### Phase 5: Testing ✅
- [ ] Unit tests для всех новых модулей
- [ ] Integration tests для разных сценариев
- [ ] Performance benchmarks
- [ ] Cost analysis (token usage)
- [ ] Edge cases (huge commits, no git history, etc.)
- [ ] Backward compatibility tests

### Phase 6: Documentation & Release ✅
- [ ] Update README.md
- [ ] Update CHANGELOG.md
- [ ] Create migration guide
- [ ] API documentation
- [ ] Example configurations
- [ ] Release notes

---

## 🚀 Timeline

**Week 1:**
- Days 1-2: Phase 1 (Critical Fixes)
- Days 3-4: Phase 2 (AI File Selector)
- Day 5: Phase 3 (Git Context)

**Week 2:**
- Days 1-2: Phase 4 (Configuration)
- Days 3-5: Phase 5 (Testing)
- Days 6-7: Phase 6 (Documentation & Release)

**Total:** ~2 weeks for complete implementation and testing

---

## 💰 Cost-Benefit Analysis

### Costs:
- Development time: ~2 weeks
- Additional API costs: ~$0.002 per commit with AI selection
- Maintenance overhead: Minimal (new configuration options)

### Benefits:
- **Accuracy improvement:** ~80-90% (based on expected metrics)
- **User satisfaction:** Значительно выше (точные commit messages)
- **Time saved:** Меньше manual editing commit messages
- **Code quality:** Лучше документированная история изменений
- **Adoption:** Больше пользователей будут доверять инструменту

### ROI:
```
Cost per commit: $0.001 (current) → $0.003 (with AI selection)
Time saved per commit: ~30 seconds (no manual editing)
Value of developer time: ~$50/hour = $0.42 per minute

Savings: $0.42 × 0.5 minutes = $0.21 per commit
Net benefit: $0.21 - $0.002 = $0.208 per commit

Break-even: Immediate (savings >> costs)
```

---

## 📚 References

### Related Documents:
- `docs/CRITICAL_IMPROVEMENTS.md` - Original improvement ideas
- `docs/DEVELOPMENT.md` - Development guidelines
- `README.md` - User-facing documentation

### External Resources:
- [Conventional Commits](https://www.conventionalcommits.org/)
- [OpenRouter API Docs](https://openrouter.ai/docs)
- [Anthropic Claude API](https://docs.anthropic.com/)

---

## ✅ Success Criteria

Проект считается успешным когда:

1. **Качество commit messages:**
   - ✅ AI генерирует точные messages в 90%+ случаев
   - ✅ Нет ложных "No relevant changes" для валидных коммитов
   - ✅ Large commits обрабатываются корректно

2. **Performance:**
   - ✅ Small commits: не медленнее текущего
   - ✅ Medium commits: допустимо +3-5 секунд за accuracy
   - ✅ Large commits: быстрее или на том же уровне

3. **User Experience:**
   - ✅ Простая конфигурация
   - ✅ Понятные error messages
   - ✅ Graceful fallbacks при ошибках
   - ✅ Обратная совместимость

4. **Cost Efficiency:**
   - ✅ Дополнительные costs оправданы улучшением качества
   - ✅ Пользователь может контролировать costs через config
   - ✅ Fallback на cheaper heuristic при необходимости

---

**Статус:** Ready for Implementation
**Next Steps:** Begin Phase 1 - Critical Fixes
**Owner:** Development Team
**Last Updated:** 2025-12-13
