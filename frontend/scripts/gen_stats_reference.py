import json, numpy as np
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.proportion import proportion_confint
from statsmodels.stats.contingency_tables import Table2x2
from statsmodels.stats.power import NormalIndPower

out = {}
out["dist"] = {
  "normPpf975": stats.norm.ppf(0.975), "normPpf80": stats.norm.ppf(0.8),
  "tCdf": [[-2.0,10,stats.t.cdf(-2.0,10)],[1.3,4,stats.t.cdf(1.3,4)],[-4.5,40,stats.t.cdf(-4.5,40)]],
  "tPpf": [[0.975,15,stats.t.ppf(0.975,15)],[0.975,3,stats.t.ppf(0.975,3)]],
  "chi2Sf": [[3.84,1,stats.chi2.sf(3.84,1)],[12.5,5,stats.chi2.sf(12.5,5)],[30,10,stats.chi2.sf(30,10)]],
  "chi2Ppf": [[0.05,6,stats.chi2.ppf(0.05,6)],[0.975,8,stats.chi2.ppf(0.975,8)]],
  "fCdf": [[4.0,2,10,stats.f.cdf(4.0,2,10)],[2.5,3,20,stats.f.cdf(2.5,3,20)]],
  "betaPpf": [[0.025,3,8,stats.beta.ppf(0.025,3,8)],[0.975,5,2,stats.beta.ppf(0.975,5,2)]],
}
x=[5.1,4.9,6.2,5.8,6.0,5.5,4.7,5.3,6.1,5.9]
y=[4.8,5.2,5.9,5.1,5.6,5.0,4.9,5.4,5.7,5.2]
z=[6.5,7.1,6.8,7.4,6.9,7.2,6.6,7.0]
t_eq=stats.ttest_ind(x,y,equal_var=True); t_w=stats.ttest_ind(x,z,equal_var=False); t_p=stats.ttest_rel(x,y); t_1=stats.ttest_1samp(x,5.0)
ci=lambda r: r.confidence_interval(0.95)
out["data"]={"x":x,"y":y,"z":z}
out["ttest"]={
 "eq":{"t":t_eq.statistic,"df":t_eq.df,"p":t_eq.pvalue,"lo":ci(t_eq).low,"hi":ci(t_eq).high},
 "welch":{"t":t_w.statistic,"df":t_w.df,"p":t_w.pvalue,"lo":ci(t_w).low,"hi":ci(t_w).high},
 "paired":{"t":t_p.statistic,"df":t_p.df,"p":t_p.pvalue,"lo":ci(t_p).low,"hi":ci(t_p).high},
 "one":{"t":t_1.statistic,"df":t_1.df,"p":t_1.pvalue,"lo":ci(t_1).low,"hi":ci(t_1).high},
}
tab=[[30,10],[15,25]]
c1=stats.chi2_contingency(tab,correction=False); c2=stats.chi2_contingency(tab,correction=True)
tab3=[[10,20,30],[20,15,12]]; c3=stats.chi2_contingency(tab3)
out["chi2"]={"table":tab,"nocorr":[c1[0],c1[1]],"yates":[c2[0],c2[1]],"table3":tab3,"r3":[c3[0],c3[1],c3[2]]}
out["fisher"]=[{"t":t,"p":stats.fisher_exact(t)[1]} for t in ([[3,1],[1,3]],[[8,2],[1,5]],[[30,10],[15,25]],[[0,5],[5,0]])]
a_=stats.f_oneway(x,y,z); out["anova"]={"f":a_.statistic,"p":a_.pvalue}
xs=[1,2,3,4,5,6,7,8,9,10]; ys=[2.1,3.9,6.2,7.8,10.1,12.2,13.8,16.1,18.0,20.3]
pr=stats.pearsonr(xs,ys); prc=pr.confidence_interval(0.95)
out["pearson"]={"x":xs,"y":ys,"r":pr.statistic,"p":pr.pvalue,"lo":prc.low,"hi":prc.high}
xr=[1,2,2,4,5,7,7,7,9,10]; yr=[3,1,4,4,6,5,9,8,7,12]
sp=stats.spearmanr(xr,yr); out["spearman"]={"x":xr,"y":yr,"rho":sp.statistic,"p":sp.pvalue}
lr=stats.linregress(xs,ys); out["linreg"]={"slope":lr.slope,"intercept":lr.intercept,"se":lr.stderr,"ise":lr.intercept_stderr,"p":lr.pvalue,"r2":lr.rvalue**2}
age=[22,25,30,35,40,45,50,55,60,65,28,33,38,43,48,53,58,63,68,70]
dis=[0,0,0,1,0,0,1,0,1,1,0,0,0,1,0,1,1,0,1,1]
m=sm.Logit(dis,sm.add_constant(age)).fit(disp=0); cim=m.conf_int()
out["logit"]={"x":age,"y":dis,"b0":m.params[0],"b1":m.params[1],"se0":m.bse[0],"se1":m.bse[1],"p1":m.pvalues[1],"ll":m.llf,"llnull":m.llnull,"lrp":m.llr_pvalue,"orlo":float(np.exp(cim[1][0])),"orhi":float(np.exp(cim[1][1]))}
out["quant"]={"x":x,"q1":float(np.quantile(x,.25)),"q2":float(np.quantile(x,.5)),"q3":float(np.quantile(x,.75)),"sd":float(np.std(x,ddof=1))}
# epi
t=Table2x2(np.array([[40,60],[20,80]]))
out["epi"]={"table":[40,60,20,80],"or":t.oddsratio,"orci":list(t.oddsratio_confint()),"rr":t.riskratio,"rrci":list(t.riskratio_confint())}
out["wilson"]=[[x_,n_,*map(float,proportion_confint(x_,n_,method="wilson"))] for x_,n_ in ((12,40),(0,20),(20,20),(87,200))]
out["cp"]=[[x_,n_,*map(float,proportion_confint(x_,n_,method="beta"))] for x_,n_ in ((12,40),(0,20),(20,20),(87,200))]
out["poisson"]=[[e,pt,float(stats.chi2.ppf(.025,2*e)/2/pt) if e else 0.0,float(stats.chi2.ppf(.975,2*e+2)/2/pt)] for e,pt in ((10,1000),(0,500),(45,3200))]
nip=NormalIndPower(); out["power"]={"n_d05":nip.solve_power(effect_size=0.5,alpha=.05,power=.8),"pow_64":float(nip.power(effect_size=0.5,nobs1=64,alpha=.05)),"pow_30_d08":float(nip.power(effect_size=0.8,nobs1=30,alpha=.05))}
tk=stats.tukey_hsd(x,y,z); tci=tk.confidence_interval(0.95)
out["tukey"]={"groups":[x,y,z],"pvalue":tk.pvalue.tolist(),"lo":tci.low.tolist(),"hi":tci.high.tolist(),"stat":tk.statistic.tolist(),"dist":[stats.studentized_range.cdf(3.5,3,12),stats.studentized_range.ppf(.95,3,12),stats.studentized_range.cdf(4.2,4,30)]}
json.dump(out,open(__import__("sys").argv[1],"w"),indent=1,default=float)
print("ok")
