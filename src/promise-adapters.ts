export function cbToP1<T, R>(f: (a: T, cb: (err: any, r: R) => void) => void) {
  return (a : T) => new Promise<R>((resolve, reject) => {
    f(a, (err, r) => {
      if (err) reject(err);
      else resolve(r);
    });
  });
}

export function cbToP2<T1, T2, R>(f: (p1: T1, p2: T2, cb: (err: any, r: R) => void) => void) {
  return (p1: T1, p2: T2) => new Promise<R>((resolve, reject) => {
    f(p1, p2, (err, r) => {
      if (err) reject(err);
      else resolve(r);
    });
  });
}

export function cbToP3<T1, T2, T3, R>(f: (p1: T1, p2: T2, p3: T3, cb: (err: any, r: R) => void) => void) {
  return (p1: T1, p2: T2, p3: T3) => new Promise<R>((resolve, reject) => {
    f(p1, p2, p3, (err, r) => {
      if (err) reject(err);
      else resolve(r);
    });
  });
}
