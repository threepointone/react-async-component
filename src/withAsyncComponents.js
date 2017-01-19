/* @flow */

import React from 'react';
import reactTreeWalker from 'react-tree-walker';
import AsyncComponentProvider from './AsyncComponentProvider';
import { STATE_IDENTIFIER } from './constants';
import type { React$Element } from './types';

function createExecContext() {
  const registry = {};
  return {
    registerComponent(id, Component) {
      registry[id] = Component;
    },
    getComponent(id) {
      return registry[id];
    },
    getResolved() {
      return Object.keys(registry).reduce(
        (acc, cur) => Object.assign(acc, { [cur]: true }),
        {},
      );
    },
  };
}

export default function withAsyncComponents(app : React$Element) {
  const execContext = createExecContext();

  const rehydrateState = typeof window !== 'undefined'
    && typeof window[STATE_IDENTIFIER] !== 'undefined'
    ? window[STATE_IDENTIFIER]
    : null;

  const appWithAsyncComponents = (
    <AsyncComponentProvider execContext={execContext}>
      {app}
    </AsyncComponentProvider>
  );

  const doWalk = (el, ctx = {}, fetchRoot = false) => {
    const resolvers = [];

    const visitor = (element, instance, context) => {
      const skipRoot = !fetchRoot && (element === el);
      if (instance
        && typeof instance.getAsyncComponentData === 'function'
        && !skipRoot
      ) {
        const { id, defer, getResolver } = instance.getAsyncComponentData();

        if (rehydrateState) {
          if (!rehydrateState.resolved[id]) {
            return false;
          }
          rehydrateState[id] = false;
        } else if (defer) {
          // Deferred, so return false to stop walking down this branch.
          return false;
        }

        const resolver = getResolver().then(C => execContext.registerComponent(id, C));
        resolvers.push({ resolver, element, context });
        return false;
      }
      return undefined;
    };

    reactTreeWalker(el, visitor, ctx);

    const nestedPromises = resolvers.map(({ resolver, element, context }) =>
      resolver.then(() => doWalk(element, context)),
    );

    return nestedPromises.length > 0
      ? Promise.all(nestedPromises)
      : Promise.resolve([]);
  };

  return doWalk(appWithAsyncComponents, {}, true)
    // Swallow errors.
    .catch(() => undefined)
    // Ensure that state rehydration is killed
    .then(() => { if (typeof window === 'object') { window[STATE_IDENTIFIER] = null; } })
    .then(() => ({
      appWithAsyncComponents,
      state: { resolved: execContext.getResolved() },
      STATE_IDENTIFIER,
    }));
}
