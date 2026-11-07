import openpyxl,sys,glob,json,os,collections
out={}
for f in sorted(glob.glob(sys.argv[1]+'/*.xlsx')):
    wb=openpyxl.load_workbook(f,read_only=True);ws=wb.active;rows=ws.iter_rows(values_only=True);h=list(next(rows))
    ix={k:i for i,k in enumerate(h) if k}
    def g(r,k):
        for kk in ix:
            if kk.startswith(k): return r[ix[kk]]
    for r in rows:
        if str(g(r,'Test Fuel Type Description') or '')!='Electricity':continue
        y,mk,md=g(r,'Model Year'),g(r,'Represented Test Veh Make'),g(r,'Represented Test Veh Model')
        A,B,C=g(r,'Target Coef A'),g(r,'Target Coef B'),g(r,'Target Coef C')
        if not A: continue
        proc=str(g(r,'Test Procedure Description') or '')
        key=(y,str(mk).strip(),str(md).strip(),round(float(A),2),round(float(B),4),round(float(C),5),g(r,'Equivalent Test Weight'))
        e=out.setdefault(key,{'udds':[],'hwy':[],'drive':g(r,'Drive System Description')})
        fe=g(r,'RND_ADJ_FE')
        if 'UDDS' in proc and fe: e['udds'].append(fe)
        elif 'Highway' in proc and fe: e['hwy'].append(fe)
rows=[]
for k,v in out.items():
    rows.append(dict(year=k[0],make=k[1],model=k[2],A=k[3],B=k[4],C=k[5],etw=k[6],drive=v['drive'],udds=max(v['udds']) if v['udds'] else None,hwy=max(v['hwy']) if v['hwy'] else None))
json.dump(rows,open(sys.argv[2],'w'))
by=collections.Counter(r['year'] for r in rows);print('configs by MY',sorted(by.items()))
models=collections.Counter((r['year'],r['make'],r['model']) for r in rows);print('distinct year/make/model',len(models))
mk=collections.Counter(r['make'] for r in rows);print(mk.most_common(40))
