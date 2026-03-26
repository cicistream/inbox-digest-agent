const TRANSITIONS = {
  new: ['new', 'ack', 'done', 'snoozed'],
  ack: ['done', 'snoozed', 'ack'],
  done: ['done'],
  snoozed: ['ack', 'done', 'snoozed'],
};

export function canTransition(fromState, toState) {
  const from = TRANSITIONS[fromState];
  if (!from) return false;
  return from.includes(toState);
}

export function assertTransition(fromState, toState) {
  if (!canTransition(fromState, toState)) {
    throw new Error(`invalid state transition: ${fromState} -> ${toState}`);
  }
}

