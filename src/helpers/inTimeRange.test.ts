import inTimeRange from "./inTimeRange";

describe("helpers", function () {
  const tests = [
    // before in same hour
    ["11:00", "11:30", new Date("2021-05-02T11:49:00.000"), false],
    // over on same hour
    ["11:00", "11:55", new Date("2021-05-02T11:49:00.000"), true],
    // after on same hour
    ["11:50", "11:55", new Date("2021-05-02T11:49:00.000"), false],
    // going over midnight before ending second day
    ["23:05", "11:55", new Date("2021-05-02T11:05:00.000"), true],
    // going over midnight after ending second day
    ["23:05", "11:00", new Date("2021-05-02T11:05:00.000"), false],
    // going over midnight after start first day
    ["23:05", "11:00", new Date("2021-05-02T23:10:00.000"), true],
    // going over midnight before start first day
    ["23:05", "11:00", new Date("2021-05-02T23:00:00.000"), false],

    // exactly on the start
    ["23:05", "11:00", new Date("2021-05-02T23:05:00.000"), true],

    // exactly on the end
    ["23:05", "11:00", new Date("2021-05-02T11:00:00.000"), true],

    // exactly same start and end
    ["23:05", "23:05", new Date("2021-05-02T11:00:00.000"), true],
  ];

  test.each(tests)(
    "inTimeRange %s to %s on %s : %s",
    function (start, stop, date, ok) {
      expect(
        inTimeRange(start as string, stop as string)(date as Date)
      ).toEqual(ok);
    }
  );
});
