// International Standard Atmosphere (troposphere) with adjustable launch-site
// elevation and ground temperature.
const R = 287.05;
const G0 = 9.80665;
const LAPSE = 0.0065;

export class Atmosphere {
  constructor({ siteElevation = 0, groundTempC = 15, groundPressure = null } = {}) {
    this.h0 = siteElevation;
    this.T0 = groundTempC + 273.15;
    // Pressure at site from ISA if not given.
    this.P0 = groundPressure ?? 101325 * Math.pow(1 - (LAPSE * siteElevation) / 288.15, G0 / (R * LAPSE));
  }

  /** Properties at height h (m) above the launch site. */
  at(h) {
    const hh = Math.max(0, h);
    const T = Math.max(216.65, this.T0 - LAPSE * hh);
    const P = this.P0 * Math.pow(T / this.T0, G0 / (R * LAPSE));
    const rho = P / (R * T);
    const a = Math.sqrt(1.4 * R * T);
    // Sutherland's law for dynamic viscosity.
    const mu = (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);
    return { T, P, rho, a, mu };
  }

  gravity(h) {
    const Re = 6371000;
    const r = Re / (Re + this.h0 + h);
    return G0 * r * r;
  }
}
