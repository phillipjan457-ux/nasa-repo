"""Local real-archive API. Run: python -m uvicorn backend.api:app --port 8020."""
from contextlib import contextmanager
from datetime import date as CalendarDate
from functools import lru_cache
import json
import os
from pathlib import Path
import sqlite3
import statistics
from typing import Literal
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from .ingest import DB, ROOT, CONFIG

app=FastAPI(title="FIREWATCH real Indonesia archive",version="1.0")
allowed_origins = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://nasa-repo-frontend.vercel.app",
    "https://nasa-repo-frontend-git-main-phillip22.vercel.app",
]
allowed_origins += [origin.strip().rstrip('/') for origin in os.getenv('FIREWATCH_ALLOWED_ORIGINS', '').split(',') if origin.strip()]
app.add_middleware(CORSMiddleware,allow_origins=allowed_origins,allow_methods=['GET'])

@contextmanager
def database():
    path=Path(os.getenv('FIREWATCH_ARCHIVE_DB',str(DB)))
    if not path.exists():raise HTTPException(503,'Import the archive before starting analysis.')
    connection=sqlite3.connect(path.resolve().as_uri()+"?mode=ro",uri=True);connection.row_factory=sqlite3.Row
    try:yield connection
    finally:connection.close()


def filters(year,month,region,daynight,detection_type="all"):
    sql='year BETWEEN 2022 AND 2025';params=[]
    if detection_type=='vegetation':sql+=' AND type=0'
    if year is not None:sql+=' AND year=?';params.append(year)
    if month:sql+=' AND month=?';params.append(month)
    if region:sql+=' AND region=?';params.append(region)
    if daynight:sql+=' AND daynight=?';params.append(daynight)
    return sql,params


def aggregate(connection,where,params):
    row=connection.execute(f"""SELECT COUNT(*) total,
      SUM(sensor='MODIS') modis,SUM(sensor='VIIRS') viirs,
      COUNT(DISTINCT CASE WHEN status='matched' AND sensor='MODIS' THEN group_id END) matched,
      COUNT(DISTINCT CASE WHEN status='possible' AND sensor='MODIS' THEN group_id END) possible,
      SUM(status='modis-only') modis_only,SUM(status='viirs-only') viirs_only,
      SUM(CASE WHEN sensor='MODIS' OR group_id IS NULL THEN 1 ELSE 0 END) activity,
      SUM(sensor='MODIS' AND status='matched') modis_matched,
      SUM(sensor='VIIRS' AND status='matched') viirs_matched,
      COUNT(DISTINCT date) days_with_records,MIN(date) first_date,MAX(date) last_date
      FROM observations WHERE {where}""",params).fetchone()
    result={k:(row[k] if row[k] is not None else None if k in {'first_date','last_date'} else 0) for k in row.keys()}
    frp={}
    for sensor in ('MODIS','VIIRS'):
        values=[r[0] for r in connection.execute(f'SELECT frp FROM observations WHERE {where} AND sensor=? AND frp IS NOT NULL',params+[sensor])]
        frp[sensor]={'n':len(values),'median':float(np.median(values)) if values else None,
                     'mean':float(np.mean(values)) if values else None,'p90':float(np.quantile(values,0.9)) if values else None}
    result['frp_by_sensor']=frp
    return result


def series(connection,where,params,period):
    # Each period counts a group once among selected observations; source counts remain separate.
    return [dict(r) for r in connection.execute(f"""SELECT {period} period,COUNT(*) detections,
       SUM(sensor='MODIS') modis,SUM(sensor='VIIRS') viirs,
       SUM(CASE WHEN sensor='MODIS' OR group_id IS NULL THEN 1 ELSE 0 END) activity,
       COUNT(DISTINCT CASE WHEN status='matched' AND sensor='MODIS' THEN group_id END) matched,
       COUNT(DISTINCT CASE WHEN status='possible' AND sensor='MODIS' THEN group_id END) possible,
       SUM(status='modis-only') modis_only,SUM(status='viirs-only') viirs_only
       FROM observations WHERE {where} GROUP BY {period} ORDER BY {period}""",params)]


def observation(row):
    return dict(id=row['id'],sensor=row['sensor'],satellite=row['satellite'],instrument=row['sensor'],product=row['product'],
        lat=row['lat'],lon=row['lon'],date=row['date'],timeUtc=row['time'],ts=row['ts']*1000,
        confidence=row['confidence'],frp=row['frp'],brightness=row['brightness'],scan=row['scan'],track=row['track'],
        daynight=row['daynight'],province=row['region'],status=row['status'],groupId=row['group_id'],links=[],anomaly=False)

@app.get('/api/archive/meta')
def meta():
    with database() as c:
        return {'data_status':'NASA FIRMS archive','years':[2022,2023,2024,2025],
            'files':[dict(r) for r in c.execute('SELECT * FROM source_files')],
            'records':c.execute('SELECT COUNT(*) FROM observations').fetchone()[0],
            'rejected':c.execute('SELECT COUNT(*) FROM rejected').fetchone()[0],
            'regions':[r[0] for r in c.execute('SELECT DISTINCT region FROM observations ORDER BY region')],
            'processed_at':c.execute("SELECT value FROM metadata WHERE key='processed_at'").fetchone()[0],
            'config':CONFIG,'coverage':'unknown: dates with detections are not valid observation coverage',
            'products':[dict(r) for r in c.execute('SELECT year,product,COUNT(*) records FROM observations GROUP BY year,product')],
            'boundary_source':'geoBoundaries gbOpen IDN ADM1; ODbL 1.0; see /api/archive/boundary-source'}

@app.get('/api/archive/dashboard')
def dashboard(year:int|None=Query(None,ge=2022,le=2025),month:int|None=Query(None,ge=1,le=12),
              region:str|None=None,daynight:Literal['D','N']|None=None,
              sensor:Literal['MODIS','VIIRS']|None=None,start_date:CalendarDate|None=None,end_date:CalendarDate|None=None,limit:int=Query(0,ge=0,le=10000),offset:int=Query(0,ge=0),detection_type:Literal['vegetation','all']='all'):
    if start_date or end_date:year,month=None,None
    where,params=filters(year,month,region,daynight,detection_type)
    if start_date and end_date and start_date>end_date:raise HTTPException(422,'Start date must not exceed end date')
    if start_date:where+=' AND date>=?';params.append(start_date.isoformat())
    if end_date:where+=' AND date<=?';params.append(end_date.isoformat())
    if sensor:where+=' AND sensor=?';params.append(sensor)
    with database() as c:
        summary=aggregate(c,where,params)
        # A deterministic page, never a fabricated or silently scaled set of markers.
        rows=c.execute(f'SELECT * FROM observations WHERE {where} ORDER BY ts,id LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
        monthly=series(c,where,params,'month');daily=series(c,where,params,'date')
        return {'summary':summary,'monthly':monthly,'daily':daily,'observations':[observation(r) for r in rows],
                'map_page':{'limit':limit,'offset':offset,'returned':len(rows),'total':summary['total']},
                'scope':{'detection_type':detection_type,'year':year,'month':month,'region':region,'daynight':daynight,'start_date':str(start_date) if start_date else None,'end_date':str(end_date) if end_date else None},'coverage':'unknown'}

@app.get('/api/archive/history')
@lru_cache(maxsize=64)
def history(region:str|None=None,detection_type:Literal['vegetation','all']='all'):
    with database() as c:
        output=[]
        for year in range(2022,2026):
            where,params=filters(year,None,region,None,detection_type)
            summary=aggregate(c,where,params)
            monthly=series(c,where,params,'month')
            regions=[dict(r) for r in c.execute(f"SELECT region,COUNT(*) detections,SUM(CASE WHEN sensor='MODIS' OR group_id IS NULL THEN 1 ELSE 0 END) activity FROM observations WHERE {where} GROUP BY region ORDER BY activity DESC",params)]
            prior=output[-1]['summary']['activity'] if output else None
            summary['change_pct']=(summary['activity']-prior)/prior*100 if prior else None
            output.append({'year':year,'summary':summary,'monthly':monthly,'regions':regions})
        return output

@app.get('/api/archive/observation/{identifier}')
def detail(identifier:str):
    with database() as c:
        row=c.execute('SELECT * FROM observations WHERE id=?',(identifier,)).fetchone()
        if not row:raise HTTPException(404,'Observation not found')
        result=observation(row);result['raw_record']=json.loads(row['raw_json'])
        result['file']=dict(c.execute('SELECT * FROM source_files WHERE id=?',(row['file_id'],)).fetchone())
        result['source_row']=row['row_number'];result['eligible_for_matching']=bool(row['eligible'])
        result['candidates']=[dict(r) for r in c.execute('SELECT * FROM candidate_pairs WHERE modis_id=? OR viirs_id=? ORDER BY score DESC',(identifier,identifier))]
        result['config']=CONFIG
        return result

@app.get('/api/archive/candidates')
def candidates(limit:int=Query(50,ge=1,le=500),offset:int=Query(0,ge=0)):
    with database() as c:
        return {'total':c.execute('SELECT COUNT(*) FROM candidate_pairs').fetchone()[0],
                'data':[dict(r) for r in c.execute('SELECT * FROM candidate_pairs ORDER BY score DESC,modis_id,viirs_id LIMIT ? OFFSET ?',(limit,offset))]}

@app.get('/api/archive/boundaries')
def boundaries():return FileResponse(ROOT/'boundaries/indonesia-adm1.geojson',media_type='application/geo+json')

@app.get('/api/archive/boundary-source')
def boundary_source():return json.loads((ROOT/'boundaries/source.json').read_text())

def archive_version():
    path = Path(os.getenv('FIREWATCH_ARCHIVE_DB', str(DB))).resolve()
    if not path.exists():
        raise HTTPException(503, 'Import the archive before starting analysis.')
    stat = path.stat()
    return str(path), stat.st_mtime_ns, stat.st_size


@lru_cache(maxsize=4)
def anomaly_rows(version, detection_type):
    with database() as connection:
        condition = " WHERE type=0" if detection_type == 'vegetation' else ""
        return connection.execute("SELECT year,month,region,SUM(CASE WHEN sensor='MODIS' OR group_id IS NULL THEN 1 ELSE 0 END) n FROM observations" + condition + " GROUP BY year,month,region").fetchall()


@lru_cache(maxsize=64)
def map_selection_total(version, where, params):
    with database() as connection:
        return connection.execute(f'SELECT COUNT(*) FROM observations WHERE {where}', params).fetchone()[0]


@app.get('/api/archive/anomalies')
@lru_cache(maxsize=8)
def anomalies(year:int=Query(2025,ge=2022,le=2025),detection_type:Literal['vegetation','all']='all'):
    with database() as c:
        rows=anomaly_rows(archive_version(), detection_type)
        grid={(r['year'],r['month'],r['region']):r['n'] for r in rows}
        result=[]
        for r in rows:
            if r['year']!=year:continue
            baseline=[grid.get((y,r['month'],r['region'])) for y in range(2022,2026) if y!=year]
            # Missing region-months are not silently filled as observed zeros.
            if any(v is None for v in baseline):continue
            med=statistics.median(baseline);mad=statistics.median(abs(v-med) for v in baseline)
            scale=1.4826*mad if mad else max(1,0.1*med)
            z=(r['n']-med)/scale
            if z>=3.5 and r['n']>=10:result.append({'region':r['region'],'month':r['month'],'observed':r['n'],'baseline':baseline,'median':med,'z':z,'fallback':mad==0})
        return {'data':sorted(result,key=lambda r:-r['z']),
                'method':'Exploratory leave-one-year-out same-region/month median/MAD; only three baseline years. Not a warning.',
                'coverage':'unknown; coverage differences can create apparent anomalies'}

@app.get('/api/archive/forecast')
@lru_cache(maxsize=2)
def forecast(detection_type:Literal['vegetation','all']='all'):
    rows=history(detection_type=detection_type);series={r['year']:{m['period']:m['activity'] for m in r['monthly']} for r in rows}
    if any(len(series[y])<12 for y in series):return {'available':False,'reason':'Insufficient monthly records; missing months are not assumed zero.'}
    errors={'seasonal_naive':[],'seasonal_mean':[]};backtest=[]
    for year in (2024,2025):
        for month in range(1,13):
            actual=series[year][month];naive=series[year-1][month]
            mean=statistics.mean(series[y][month] for y in series if y<year)
            errors['seasonal_naive'].append(abs(actual-naive));errors['seasonal_mean'].append(abs(actual-mean))
            backtest.append({'year':year,'month':month,'actual':actual,'seasonal_naive':naive,'seasonal_mean':mean})
    maes={k:statistics.mean(v) for k,v in errors.items()};best=min(maes,key=maes.get)
    band=float(np.quantile(errors[best],0.8));out=[]
    for month in (1,2,3):
        point=series[2025][month] if best=='seasonal_naive' else statistics.mean(series[y][month] for y in series)
        out.append({'month':month,'year':2026,'point':point,'low':max(0,point-band),'high':point+band})
    return {'available':True,'model':best,'mae':maes,'backtest':backtest,'outlook':out,
            'training':'2022-2025','test_periods':[2024,2025],
            'interval':'Empirical 80th-percentile absolute backtest error band, not calibrated prediction coverage.',
            'limitations':'Retrospective Jan-Mar 2026 outlook from archive ending 2025, not a current forecast. Only four seasons; selected and evaluated on the same backtest windows. Forecasts detected activity, not fires.'}


@app.get('/api/archive/sensitivity')
@lru_cache(maxsize=1)
def sensitivity():
    """Re-evaluate stored gate-passing evidence under stricter prototype gates."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import min_weight_full_bipartite_matching
    with database() as c:
        original=c.execute('SELECT modis_id,viirs_id,distance_km,dt_min FROM candidate_pairs').fetchall()
    results=[]
    for distance,time in [(0.5,15),(1.0,30)]:
        pairs=[]
        for r in original:
            if r['distance_km']>distance or r['dt_min']>time:continue
            score=0.6*(1-r['distance_km']/distance)+0.4*(1-r['dt_min']/time)
            if score>=0.45:pairs.append((r['modis_id'],r['viirs_id'],score))
        ms={k:i for i,k in enumerate(sorted({r[0] for r in pairs}))};vs={k:i for i,k in enumerate(sorted({r[1] for r in pairs}))}
        selected=[]
        if ms and vs:
            rr=[ms[r[0]] for r in pairs]+list(range(len(ms)))
            cc=[vs[r[1]] for r in pairs]+[len(vs)+i for i in range(len(ms))]
            cost=[1-r[2]+1e-8 for r in pairs]+[1.0]*len(ms)
            ai,bi=min_weight_full_bipartite_matching(coo_matrix((cost,(rr,cc)),shape=(len(ms),len(vs)+len(ms))).tocsr())
            chosen=set(zip(ai,bi));selected=[r[2] for r in pairs if (ms[r[0]],vs[r[1]]) in chosen]
        results.append({'distance_km':distance,'time_minutes':time,'reviewable_pairs':len(pairs),
                        'assigned_groups':len(selected),'matched':sum(x>=0.7 for x in selected),
                        'possible':sum(0.45<=x<0.7 for x in selected)})
    return {'data':results,'note':'Prototype threshold sensitivity, not matching accuracy. Wider gates require a separate processing version. No independently labeled reference set.'}


# Full-selection map representation. No records are dropped or sampled. Bins
# consolidate all selected observations at the current zoom, and split on zoom-in.
def selection(year,month,region,daynight,start_date,end_date,detection_type="all"):
    if start_date and end_date and start_date>end_date:
        raise HTTPException(422,'Start date must not exceed end date')
    if start_date or end_date:year,month=None,None
    where,params=filters(year,month,region,daynight,detection_type)
    if start_date:where+=' AND date>=?';params.append(str(start_date))
    if end_date:where+=' AND date<=?';params.append(str(end_date))
    return where,params

@app.get('/api/archive/map')
def map_data(year:int|None=Query(None,ge=2022,le=2025),month:int|None=Query(None,ge=1,le=12),
             region:str|None=None,daynight:Literal['D','N']|None=None,
             start_date:CalendarDate|None=None,end_date:CalendarDate|None=None,
             view:Literal['harmonized','modis','viirs']='harmonized',zoom:int=Query(5,ge=4,le=16),
             west:float=Query(-180,ge=-180,le=180),east:float=Query(180,ge=-180,le=180),
             south:float=Query(-90,ge=-90,le=90),north:float=Query(90,ge=-90,le=90),detection_type:Literal['vegetation','all']='all'):
    if west>east or south>north:raise HTTPException(422,'Invalid viewport bounds')
    return cached_map_data(archive_version(), year, month, region, daynight, start_date,
                           end_date, view, zoom, west, east, south, north, detection_type)


@lru_cache(maxsize=16)
def cached_map_data(version, year, month, region, daynight, start_date, end_date,
                    view, zoom, west, east, south, north, detection_type):
    where,params=selection(year,month,region,daynight,start_date,end_date,detection_type)
    if view=='harmonized':where+=" AND (sensor='MODIS' OR group_id IS NULL)"
    else:where+=' AND sensor=?';params.append(view.upper())
    step=360/(2**zoom*4)
    flags={(y,r['month'],r['region']) for y in range(2022,2026) for r in anomalies(y,detection_type)['data']}
    with database() as c:
        c.create_function('anomaly_flag',3,lambda y,m,r:int((y,m,r) in flags))
        total=map_selection_total(version, where, tuple(params))
        where+=' AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?';params=params+[west,east,south,north]
        sql=f"""SELECT CAST((lon+180)/? AS INTEGER) gx,CAST((lat+90)/? AS INTEGER) gy,
          AVG(lat) lat,AVG(lon) lon,COUNT(*) count,MIN(id) id,
          MIN(lat) south,MAX(lat) north,MIN(lon) west,MAX(lon) east,
          MAX(CASE WHEN scan>0 THEN scan END) scan_km,
          MAX(CASE WHEN track>0 THEN track END) track_km,
          SUM(sensor='MODIS') modis,SUM(sensor='VIIRS') viirs,
          SUM(sensor='MODIS') source_modis,
          SUM(sensor='VIIRS' OR (sensor='MODIS' AND group_id IS NOT NULL)) source_viirs,
          SUM(status='matched') matched,SUM(status='possible') possible,
          SUM(status='modis-only') modis_only,SUM(status='viirs-only') viirs_only,
          SUM(anomaly_flag(year,month,region)) anomaly_count
          FROM observations WHERE {where} GROUP BY gx,gy ORDER BY gx,gy"""
        points=[dict(r) for r in c.execute(sql,[step,step]+params)]
    return {'clusters':points,'represented':sum(r['count'] for r in points),'total':total,
            'step':step,'view':view,'scope':'all selected records; clustered at viewport zoom; no sample or record cap'}

@app.get('/api/archive/calendar')
def calendar_month(year:int=Query(2025,ge=2022,le=2025),month:int=Query(1,ge=1,le=12),
                   region:str|None=None,daynight:Literal['D','N']|None=None,
                   start_date:CalendarDate|None=None,end_date:CalendarDate|None=None,detection_type:Literal['vegetation','all']='all'):
    import calendar
    from datetime import date
    where,params=filters(year,month,region,daynight,detection_type)
    if start_date and end_date and start_date>end_date:raise HTTPException(422,'Invalid date range')
    if start_date:where+=' AND date>=?';params.append(str(start_date))
    if end_date:where+=' AND date<=?';params.append(str(end_date))
    with database() as c:
        observed={r['period']:r for r in series(c,where,params,'date')}
    days=[]
    for day in range(1,calendar.monthrange(year,month)[1]+1):
        stamp=date(year,month,day)
        in_range=(start_date is None or stamp>=start_date) and (end_date is None or stamp<=end_date)
        record=observed.get(stamp.isoformat())
        days.append({'date':stamp.isoformat(),'day':day,'in_range':in_range,
                     'activity':record['activity'] if record else None,
                     'detections':record['detections'] if record else None,
                     'modis':record['modis'] if record else None,'viirs':record['viirs'] if record else None,
                     'matched':record['matched'] if record else None,'possible':record['possible'] if record else None})
    values=[r['activity'] for r in days if r['activity'] is not None]
    thresholds=[float(np.quantile(values,q)) for q in (0.5,0.75,0.9)] if values else []
    return {'year':year,'month':month,'weekday_offset':(date(year,month,1).weekday()+1)%7,
            'days':days,'thresholds':thresholds,'activity':sum(values),
            'coverage':'unknown; missing dates are not converted to observed zeros'}

@app.get('/api/archive/day')
def day_detail(date:CalendarDate,region:str|None=None,daynight:Literal['D','N']|None=None,detection_type:Literal['vegetation','all']='all'):
    if date.year not in range(2022,2026):raise HTTPException(422,'Date outside archive')
    where,params=filters(date.year,None,region,daynight,detection_type);where+=' AND date=?';params.append(str(date))
    with database() as c:
        totals=aggregate(c,where,params)
        regions=[dict(r) for r in c.execute(f"SELECT region,COUNT(*) detections,SUM(CASE WHEN sensor='MODIS' OR group_id IS NULL THEN 1 ELSE 0 END) activity FROM observations WHERE {where} GROUP BY region ORDER BY activity DESC",params)]
    return {'date':str(date),'summary':totals,'regions':regions,'coverage':'unknown'}

from .views import router as views_router
app.include_router(views_router)
