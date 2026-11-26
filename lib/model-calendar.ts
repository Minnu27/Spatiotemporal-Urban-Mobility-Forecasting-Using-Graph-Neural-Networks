// Matches pandas USFederalHolidayCalendar used by the supplied Colab model.
// Fare rules have their own New York legal-holiday calendar.
export function isModelHoliday(year:number,month:number,day:number){
 const at=Date.UTC(year,month-1,day),oneDay=86400000;
 for(const y of [year-1,year,year+1]){
  const fixed=[[1,1],[6,19],[7,4],[11,11],[12,25]];
  for(const [m,d] of fixed){
   const actual=Date.UTC(y,m-1,d),weekday=new Date(actual).getUTCDay();
   const observed=actual+(weekday===6?-oneDay:weekday===0?oneDay:0);
   if(at===observed)return true;
  }
  const nth=(m:number,weekday:number,n:number)=>Date.UTC(y,m-1,1+(weekday-new Date(Date.UTC(y,m-1,1)).getUTCDay()+7)%7+7*(n-1));
  if([nth(1,1,3),nth(2,1,3),nth(9,1,1),nth(10,1,2),nth(11,4,4)].includes(at))return true;
  const end=Date.UTC(y,5,0),lastMonday=end-((new Date(end).getUTCDay()+6)%7)*oneDay;
  if(at===lastMonday)return true;
 }
 return false;
}
