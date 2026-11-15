'use strict';

function browserOptions(command) {
  const reading = command === 'collect';
  return {
    launch: { headless: reading, ...(reading ? {} : { args: ['--start-maximized'] }) },
    context: { locale: 'es-ES', timezoneId: 'America/New_York',
      viewport: reading ? { width: 1280, height: 900 } : null }
  };
}
module.exports = { browserOptions };
