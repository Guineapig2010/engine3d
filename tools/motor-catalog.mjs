// Curated catalog of A–F class motors (plus the tiny 1/4A and 1/2A Estes motors).
// Each entry points to a RASP .eng thrust curve in data/eng/ (certification data
// mirrored from thrustcurve.org via github.com/openrocket/motor-database) and lists
// every delay variant that is (or was) sold, so a "C6" curve becomes
// C6-0, C6-3, C6-5 and C6-7 with their own delay timing, mass and label colour.
//
//  src      – raw file name in the download folder
//  file     – clean file name stored in data/eng/
//  delays   – array of delay seconds; 'P' = plugged (no ejection charge)
//  suffix   – letter(s) after the delay (Estes "T" = 13 mm mini, AeroTech propellant code)
//  delayFiles – optional per-delay curve override (separately certified variants)
//  massPerDelay – grams added per second of delay when the base curve file is a
//               booster (-0) motor that has no delay element/ejection charge.
export const CATALOG = [
  // ---------------- Estes black powder, 13 mm "mini" ----------------
  { src: 'Estes_Industries_14A3_5f4294d20002e900000004df.eng', file: 'Estes_1-4A3T.eng', mfr: 'Estes', common: '1/4A3', suffix: 'T', delays: [3] },
  { src: 'Estes_Industries_12A3_5f4294d20002e900000004e0.eng', file: 'Estes_1-2A3T.eng', mfr: 'Estes', common: '1/2A3', suffix: 'T', delays: [2, 4] },
  { src: 'Estes_Industries_A3_5f4294d20002e900000004e2.eng', file: 'Estes_A3T.eng', mfr: 'Estes', common: 'A3', suffix: 'T', delays: [4] },
  { src: 'Estes_Industries_A10_5f4294d20002e900000004e4.eng', file: 'Estes_A10T.eng', mfr: 'Estes', common: 'A10', suffix: 'T', delays: [0, 3, 'P'],
    delayFiles: { 0: { src: 'Estes_Industries_A10_624aff26a49a690004b83002.eng', file: 'Estes_A10-0T.eng' } } },
  // ---------------- Estes black powder, 18 mm standard ----------------
  { src: 'Estes_Industries_12A6_5f4294d20002e900000004e1.eng', file: 'Estes_1-2A6.eng', mfr: 'Estes', common: '1/2A6', suffix: '', delays: [2] },
  { src: 'Estes_Industries_A8_5f4294d20002e900000004e3.eng', file: 'Estes_A8.eng', mfr: 'Estes', common: 'A8', suffix: '', delays: [3, 5] },
  { src: 'Estes_Industries_B4_5f4294d20002e900000004e5.eng', file: 'Estes_B4.eng', mfr: 'Estes', common: 'B4', suffix: '', delays: [2, 4] },
  { src: 'Estes_Industries_B6_5f4294d20002e90000000414.eng', file: 'Estes_B6.eng', mfr: 'Estes', common: 'B6', suffix: '', delays: [0, 2, 4, 6], massPerDelay: 0.6, baseIsBooster: true },
  { src: 'Estes_Industries_C5_5f4294d20002e900000008c0.eng', file: 'Estes_C5.eng', mfr: 'Estes', common: 'C5', suffix: '', delays: [3] },
  { src: 'Estes_Industries_C6_5f4294d20002e900000004e7.eng', file: 'Estes_C6.eng', mfr: 'Estes', common: 'C6', suffix: '', delays: [0, 3, 5, 7],
    delayFiles: { 0: { src: 'Estes_Industries_C6_5f4294d20002e90000000833.eng', file: 'Estes_C6-0.eng' } } },
  // ---------------- Estes black powder, 24 mm ----------------
  { src: 'Estes_Industries_C11_5f4294d20002e900000004e8.eng', file: 'Estes_C11.eng', mfr: 'Estes', common: 'C11', suffix: '', delays: [0, 3, 5, 7] },
  { src: 'Estes_Industries_D11_5f4294d20002e900000004e9.eng', file: 'Estes_D11.eng', mfr: 'Estes', common: 'D11', suffix: '', delays: ['P'] },
  { src: 'Estes_Industries_D12_5f4294d20002e900000004ea.eng', file: 'Estes_D12.eng', mfr: 'Estes', common: 'D12', suffix: '', delays: [0, 3, 5, 7] },
  { src: 'Estes_Industries_E9_5f4294d20002e90000000416.eng', file: 'Estes_E9.eng', mfr: 'Estes', common: 'E9', suffix: '', delays: [0, 4, 6, 8], massPerDelay: 0.6, baseIsBooster: true },
  { src: 'Estes_Industries_E12_5f4294d20002e900000007ad.eng', file: 'Estes_E12.eng', mfr: 'Estes', common: 'E12', suffix: '', delays: [0, 4, 6, 8] },
  // ---------------- Estes black powder, 29 mm ----------------
  { src: 'Estes_Industries_E16_5f4294d20002e900000007e6.eng', file: 'Estes_E16.eng', mfr: 'Estes', common: 'E16', suffix: '', delays: [0, 4, 6, 8] },
  { src: 'Estes_Industries_F15_5f4294d20002e900000007e5.eng', file: 'Estes_F15.eng', mfr: 'Estes', common: 'F15', suffix: '', delays: [0, 4, 6, 8] },
  // ---------------- Estes-branded composites (made by AeroTech) ----------------
  { src: 'Estes_Industries_E30_5f4294d20002e900000007af.eng', file: 'Estes_E30.eng', mfr: 'Estes', common: 'E30', suffix: '', delays: [4, 7], propellant: 'Composite (Blue Thunder)' },
  { src: 'Estes_Industries_F26_5fc5ac0c995c080004e6edc8.eng', file: 'Estes_F26FJ.eng', mfr: 'Estes', common: 'F26', suffix: 'FJ', delays: [6, 9], propellant: 'Composite (Black Jack/fast)' },
  { src: 'Estes_Industries_F50_5f4294d20002e900000007b3.eng', file: 'Estes_F50.eng', mfr: 'Estes', common: 'F50', suffix: '', delays: [4, 6, 9], propellant: 'Composite (Blue Thunder)' },
  // ---------------- AeroTech single-use composites ----------------
  { src: 'AeroTech_D13_5f4294d20002e9000000027c.eng', file: 'AeroTech_D13W.eng', mfr: 'AeroTech', common: 'D13', suffix: 'W', delays: [4, 7, 10], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_D21_5f4294d20002e9000000027d.eng', file: 'AeroTech_D21T.eng', mfr: 'AeroTech', common: 'D21', suffix: 'T', delays: [4, 7], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_D24_61f977866f707500049c8fb3.eng', file: 'AeroTech_D24T.eng', mfr: 'AeroTech', common: 'D24', suffix: 'T', delays: [4, 7], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_D15_5f4294d20002e9000000027b.eng', file: 'AeroTech_D15T.eng', mfr: 'AeroTech', common: 'D15', suffix: 'T', delays: [4, 6, 8], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_E15_5f4294d20002e90000000284.eng', file: 'AeroTech_E15W.eng', mfr: 'AeroTech', common: 'E15', suffix: 'W', delays: [4, 7], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_E18_5f4294d20002e9000000027e.eng', file: 'AeroTech_E18W.eng', mfr: 'AeroTech', common: 'E18', suffix: 'W', delays: [4, 7], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_E28_5f4294d20002e9000000027f.eng', file: 'AeroTech_E28T.eng', mfr: 'AeroTech', common: 'E28', suffix: 'T', delays: [2, 5, 8], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_E23_5f4294d20002e90000000281.eng', file: 'AeroTech_E23T.eng', mfr: 'AeroTech', common: 'E23', suffix: 'T', delays: [5, 8], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_F24_5f4294d20002e90000000286.eng', file: 'AeroTech_F24W.eng', mfr: 'AeroTech', common: 'F24', suffix: 'W', delays: [4, 7], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_F39_5f4294d20002e90000000287.eng', file: 'AeroTech_F39T.eng', mfr: 'AeroTech', common: 'F39', suffix: 'T', delays: [3, 6, 9], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_F44_5f4294d20002e900000007ef.eng', file: 'AeroTech_F44W.eng', mfr: 'AeroTech', common: 'F44', suffix: 'W', delays: [4, 8], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_F20_5f4294d20002e90000000822.eng', file: 'AeroTech_F20W.eng', mfr: 'AeroTech', common: 'F20', suffix: 'W', delays: [4, 7], propellant: 'Composite (White Lightning)' },
  { src: 'AeroTech_F23_5f4294d20002e90000000453.eng', file: 'AeroTech_F23FJ.eng', mfr: 'AeroTech', common: 'F23', suffix: 'FJ', delays: [4, 7], propellant: 'Composite (Black Jack/fast)' },
  { src: 'AeroTech_F42_5f4294d20002e9000000045a.eng', file: 'AeroTech_F42T.eng', mfr: 'AeroTech', common: 'F42', suffix: 'T', delays: [4, 8], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_F52_5f4294d20002e9000000045c.eng', file: 'AeroTech_F52T.eng', mfr: 'AeroTech', common: 'F52', suffix: 'T', delays: [5, 8, 11], propellant: 'Composite (Blue Thunder)' },
  { src: 'AeroTech_F67_5f4294d20002e9000000088a.eng', file: 'AeroTech_F67W.eng', mfr: 'AeroTech', common: 'F67', suffix: 'W', delays: [4, 6, 9], propellant: 'Composite (White Lightning)' },
];
