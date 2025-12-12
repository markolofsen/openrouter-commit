import chalk from 'chalk';

/**
 * Promotional messages configuration
 */
const PROMO_MESSAGES = [
  {
    text: '🚀 AI Django → Ship SaaS in 30s',
    url: 'https://djangocfg.com',
    name: 'DjangoCFG',
  },
  {
    text: '⚡ Django + AI + Next.js → Done',
    url: 'https://djangocfg.com',
    name: 'DjangoCFG',
  },
  {
    text: '🎯 AI builds your SaaS infrastructure',
    url: 'https://djangocfg.com',
    name: 'DjangoCFG',
  },
];

/**
 * Display probability (1 in 100 = 1%)
 */
const DISPLAY_PROBABILITY = 0.01;

/**
 * Show promotional message with 1% probability
 */
export function maybeShowPromo(): void {
  // Random check (1% chance)
  if (Math.random() > DISPLAY_PROBABILITY) {
    return;
  }

  // Select random message
  const promo = PROMO_MESSAGES[Math.floor(Math.random() * PROMO_MESSAGES.length)];

  if (!promo) {
    return;
  }

  // Create beautiful box
  const line = '─'.repeat(50);
  const padding = ' '.repeat(2);

  console.log('');
  console.log(chalk.cyan('┌' + line + '┐'));
  console.log(chalk.cyan('│') + padding + chalk.bold.white(promo.text.padEnd(48)) + padding + chalk.cyan('│'));
  console.log(chalk.cyan('│') + padding + chalk.gray(promo.url.padEnd(48)) + padding + chalk.cyan('│'));
  console.log(chalk.cyan('└' + line + '┘'));
  console.log('');
}

/**
 * Force show promo (for testing)
 */
export function showPromo(): void {
  const promo = PROMO_MESSAGES[0];

  if (!promo) {
    return;
  }

  const line = '─'.repeat(50);
  const padding = ' '.repeat(2);

  console.log('');
  console.log(chalk.cyan('┌' + line + '┐'));
  console.log(chalk.cyan('│') + padding + chalk.bold.white(promo.text.padEnd(48)) + padding + chalk.cyan('│'));
  console.log(chalk.cyan('│') + padding + chalk.gray(promo.url.padEnd(48)) + padding + chalk.cyan('│'));
  console.log(chalk.cyan('└' + line + '┘'));
  console.log('');
}
