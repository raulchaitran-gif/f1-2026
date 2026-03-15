const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchWithCache(key, url) {
  const now = Date.now();
  if (CACHE[key] && now - CACHE[key].ts < CACHE_TTL) return CACHE[key].data;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const data = await res.json();
  CACHE[key] = { data, ts: now };
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const type = req.query.type || 'schedule';
  const BASE = 'https://api.jolpi.ca/ergast/f1';
  const YEAR = 2026;

  try {
    if (type === 'schedule') {
      const data = await fetchWithCache('schedule', `${BASE}/${YEAR}.json?limit=30`);
      const races = data.MRData.RaceTable.Races.map(r => ({
        round: parseInt(r.round),
        name: r.raceName,
        circuit: r.Circuit.circuitName,
        country: r.Circuit.Location.country,
        city: r.Circuit.Location.locality,
        date: r.date,
        time: r.time || null,
        fp1: r.FirstPractice || null,
        fp2: r.SecondPractice || null,
        fp3: r.ThirdPractice || null,
        quali: r.Qualifying || null,
        sprint: r.Sprint || null,
        sprintQuali: r.SprintQualifying || null,
      }));
      return res.status(200).json({ races });
    }

    if (type === 'results') {
      const round = req.query.round || 'last';
      const data = await fetchWithCache(`results_${round}`, `${BASE}/${YEAR}/${round}/results.json`);
      const race = data.MRData.RaceTable.Races[0];
      if (!race) return res.status(200).json({ results: null });
      const results = race.Results.slice(0, 10).map(r => ({
        pos: parseInt(r.position),
        driver: `${r.Driver.givenName} ${r.Driver.familyName}`,
        code: r.Driver.code,
        team: r.Constructor.name,
        time: r.Time ? r.Time.time : r.status,
        points: parseFloat(r.points),
        grid: parseInt(r.grid),
        laps: parseInt(r.laps),
        fastest: r.FastestLap ? r.FastestLap.Time.time : null,
        fastestLap: r.FastestLap?.rank === '1',
      }));
      return res.status(200).json({
        race: { name: race.raceName, circuit: race.Circuit.circuitName, date: race.date, round: parseInt(race.round) },
        results,
      });
    }

    if (type === 'standings') {
      const [driversData, constructorsData] = await Promise.all([
        fetchWithCache('drivers', `${BASE}/${YEAR}/driverStandings.json`),
        fetchWithCache('constructors', `${BASE}/${YEAR}/constructorStandings.json`),
      ]);
      const driverList = driversData.MRData.StandingsTable.StandingsLists[0];
      const consList = constructorsData.MRData.StandingsTable.StandingsLists[0];
      const drivers = driverList ? driverList.DriverStandings.slice(0, 10).map(d => ({
        pos: parseInt(d.position),
        driver: `${d.Driver.givenName} ${d.Driver.familyName}`,
        code: d.Driver.code,
        team: d.Constructors[0].name,
        points: parseFloat(d.points),
        wins: parseInt(d.wins),
      })) : [];
      const constructors = consList ? consList.ConstructorStandings.map(c => ({
        pos: parseInt(c.position),
        name: c.Constructor.name,
        points: parseFloat(c.points),
        wins: parseInt(c.wins),
      })) : [];
      return res.status(200).json({ drivers, constructors, round: driverList?.round || 0 });
    }

    if (type === 'next') {
      const data = await fetchWithCache('next', `${BASE}/${YEAR}/next.json`);
      const race = data.MRData.RaceTable.Races[0];
      if (!race) return res.status(200).json({ next: null });
      return res.status(200).json({
        next: {
          round: parseInt(race.round),
          name: race.raceName,
          circuit: race.Circuit.circuitName,
          country: race.Circuit.Location.country,
          city: race.Circuit.Location.locality,
          date: race.date,
          time: race.time,
        }
      });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
