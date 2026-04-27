/* eslint-disable @typescript-eslint/no-explicit-any */

interface MockDbState {
  selectResults: any[][];
  insertResults: any[][];
  updatedRows: any[];
  deletes: unknown[];
}

export interface MockDb {
  db: any;
  state: MockDbState;
  queueSelect: (rows: any[]) => void;
  queueInsert: (rows: any[]) => void;
  reset: () => void;
}

function makeSelectChain(pullResult: () => any[]): any {
  const chain: any = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.having = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.rightJoin = () => chain;
  chain.fullJoin = () => chain;
  chain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(pullResult()).then(onFulfilled, onRejected);
  chain.catch = (onRejected: any) => Promise.resolve(pullResult()).catch(onRejected);
  return chain;
}

function makeInsertChain(pullResult: () => any[]): any {
  const valuesChain: any = {};
  valuesChain.returning = () => Promise.resolve(pullResult());
  valuesChain.onConflictDoNothing = () => valuesChain;
  valuesChain.onConflictDoUpdate = () => valuesChain;
  valuesChain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(pullResult()).then(onFulfilled, onRejected);
  valuesChain.catch = (onRejected: any) => Promise.resolve(pullResult()).catch(onRejected);

  const chain: any = {};
  chain.values = () => valuesChain;
  return chain;
}

function makeDeleteChain(track: (where: unknown) => void): any {
  const whereChain: any = {
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ rowCount: 1 }).then(onFulfilled, onRejected),
    catch: (onRejected: any) => Promise.resolve({ rowCount: 1 }).catch(onRejected),
  };
  const chain: any = {};
  chain.where = (arg: unknown) => {
    track(arg);
    return whereChain;
  };
  return chain;
}

function makeUpdateChain(
  track: (row: any) => void,
  pullReturning: () => any[],
): any {
  const whereChain: any = {
    returning: () => Promise.resolve(pullReturning()),
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ rowCount: 1 }).then(onFulfilled, onRejected),
    catch: (onRejected: any) => Promise.resolve({ rowCount: 1 }).catch(onRejected),
  };
  const setChain: any = {
    set: (patch: any) => {
      track(patch);
      return { where: () => whereChain };
    },
  };
  return setChain;
}

export function createMockDb(): MockDb {
  const state: MockDbState = {
    selectResults: [],
    insertResults: [],
    updatedRows: [],
    deletes: [],
  };

  const pullSelect = (): any[] => state.selectResults.shift() ?? [];
  const pullInsert = (): any[] => state.insertResults.shift() ?? [];
  const trackUpdate = (row: any): void => {
    state.updatedRows.push(row);
  };
  const trackDelete = (where: unknown): void => {
    state.deletes.push(where);
  };

  const db: any = {
    select: () => makeSelectChain(pullSelect),
    insert: () => makeInsertChain(pullInsert),
    update: () => makeUpdateChain(trackUpdate, pullInsert),
    delete: () => makeDeleteChain(trackDelete),
    transaction: async (cb: (tx: any) => Promise<any>) => cb(db),
  };

  return {
    db,
    state,
    queueSelect: (rows) => {
      state.selectResults.push(rows);
    },
    queueInsert: (rows) => {
      state.insertResults.push(rows);
    },
    reset: () => {
      state.selectResults.length = 0;
      state.insertResults.length = 0;
      state.updatedRows.length = 0;
      state.deletes.length = 0;
    },
  };
}
