'use strict';

const { RECIPIENT_TYPES, classifyRecipient } = require('./recipient-classifier');

function renderGreeting(contact, options = {}) {
  const { weekday = 'Thursday', propertyAddress = '', senderName = 'Montelli' } = options;
  const classification = classifyRecipient(contact);
  const name = (contact.contactName || '').trim();
  const firstName = (contact.firstName || '').trim();

  const baseIntent = `My name is ${senderName}, and I'm looking to purchase it as a rental for my portfolio.`;

  switch (classification.recipientType) {
    case RECIPIENT_TYPES.PERSON: {
      const greetName = firstName || name.split(' ')[0] || name;
      return `Happy ${weekday}, ${greetName}! Are you still accepting offers for ${propertyAddress}? ${baseIntent}`;
    }

    case RECIPIENT_TYPES.TEAM: {
      return `Happy ${weekday}! Is the ${name} still accepting offers for ${propertyAddress}? ${baseIntent}`;
    }

    case RECIPIENT_TYPES.BROKERAGE:
    case RECIPIENT_TYPES.COMPANY:
    case RECIPIENT_TYPES.LLC:
    case RECIPIENT_TYPES.TRUST:
    case RECIPIENT_TYPES.ESTATE:
    case RECIPIENT_TYPES.GOVERNMENT: {
      return `Happy ${weekday}! Is ${name} still accepting offers for ${propertyAddress}? ${baseIntent}`;
    }

    case RECIPIENT_TYPES.UNKNOWN:
    default: {
      return `Happy ${weekday}! Are you still accepting offers for ${propertyAddress}? ${baseIntent}`;
    }
  }
}

module.exports = { renderGreeting };
