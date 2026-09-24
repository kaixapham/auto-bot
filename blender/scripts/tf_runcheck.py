
import bpy
def run(frames, gapframes=()):
    ns={}; exec(bpy.data.texts["tf_lib.py"].as_string(), ns); P=ns['spec']()
    pairs=[(p['name'],p['parent']) for p in P if p['parent'] and p['geo'] and p['parent']!='root']
    pairs=[(c,('finarm'+c[3:] if c.startswith('fin.') else {'neckC':'neckB','neckD':'neckC'}.get(c,p))) for c,p in pairs]
    adj=set(tuple(sorted(x)) for x in pairs)|{("head","neckD"),("fin.L","finarm.L"),("finarm.L","shin.L"),("finarm.R","shin.R"),("fin.R","finarm.R"),("fin.L","shin.L"),("fin.R","shin.R")}
    JOINT={"horn.L x horntip.L","horn.R x horntip.R","pelvis x thigh.L","pelvis x thigh.R","chest x pelvis","shin.L x thigh.L","shin.R x thigh.R","crest x head"}
    ck={}; exec(bpy.data.texts["tf_check.py"].as_string(), ck)
    base=ck['overlaps'](1); bad={}; gap={}
    for f in frames:
        r=ck['overlaps'](f)
        for k,n in r.items():
            a_,b_=k.split(" x ")
            lim=base.get(k,0)*(1.8 if k in JOINT else 1.3)+(30 if k in JOINT else 6)
            if "fin" in k: lim=max(lim,80)
            if tuple(sorted((a_,b_))) in adj and n<=lim: continue
            if k=="hatch.L x hatch.R" and n<=4: continue
            bad.setdefault(k,[]).append((f,n))
    for f in gapframes:
        for k,d in ck['gaps'](f,pairs,tol=0.02).items(): gap.setdefault(k,[]).append((f,d))
    return {"bad":{k:v[:5] for k,v in bad.items()},"gap":{k:v[:3] for k,v in gap.items()},"basenon":{k:v for k,v in base.items() if tuple(sorted(k.split(' x '))) not in adj}}
