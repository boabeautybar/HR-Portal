-- Terminations Tracker — historical rows from the spreadsheet Sagaree keeps.
-- Blanks are preserved as blanks; nothing is invented. Dates that could not
-- be read confidently are left NULL with the original text kept in
-- event_date_raw so they can be corrected rather than guessed at.
-- Idempotent: re-running will not duplicate (guarded on name + raw date).

insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B061','Edeline Tapfumanei','Nail Tech','Westlake',date '2025-12-01','1-Dec-25','NOVEMBER - DECEMBER 2025','Failure to comply to Absenteeism & Insubordination','Terminated via Disciplinary Hearing: No show','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Edeline Tapfumanei' and coalesce(event_date_raw,'')=coalesce('1-Dec-25',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Loice Zunde','Nail Tech','Buitengracht',date '2025-10-20','20-Oct-25','NOVEMBER - DECEMBER 2025','Terminated due to Absenteeism','Employee requested an additional 3-4 months unpaid leave','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Loice Zunde' and coalesce(event_date_raw,'')=coalesce('20-Oct-25',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B283','Nonkoliso Nkume','Nail Tech','Claremont',date '2025-11-26','26-Nov-25','NOVEMBER - DECEMBER 2025','Terminated due to Abscondment',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Nonkoliso Nkume' and coalesce(event_date_raw,'')=coalesce('26-Nov-25',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B461','Zanele Xakekile','Nail Tech','Riverlands',date '2025-11-21','21-Nov-25','NOVEMBER - DECEMBER 2025','Terminated due to Absenteeism',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Zanele Xakekile' and coalesce(event_date_raw,'')=coalesce('21-Nov-25',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','Pending','Aimee Koff','AM','Sea Point',date '2025-12-09','9-Dec-25','NOVEMBER - DECEMBER 2025','Terminated employment','Terminated employment due to abscense from the training assessment period (total days paid is fror 1, 2, 4 and half of the 5th = 3.5 days','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Aimee Koff' and coalesce(event_date_raw,'')=coalesce('9-Dec-25',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B768','Khanyisile Dube','Nail Tech','Mushroom',date '2025-12-25','25/12/2025','JANUARY 2026','Terminated by HR','Gross Negligence and Abesenteesim','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Khanyisile Dube' and coalesce(event_date_raw,'')=coalesce('25/12/2025',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B396M','Rushda Otto','SM','Riverlands',date '2026-01-20','20/01/2026','JANUARY 2026','Dismissed by HR','Absconded','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Rushda Otto' and coalesce(event_date_raw,'')=coalesce('20/01/2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B236','Phiona Ronnah','Nail Tech','Kloof',date '2025-11-24','24/11/2025','JANUARY 2026','Dismissed by HR','Absconded','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Phiona Ronnah' and coalesce(event_date_raw,'')=coalesce('24/11/2025',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Asive Mdela','Under Training','BOA Head Office',date '2026-01-28','28-Jan-26','FEBRUARY 2026','Dismissed by HR','Decision after Disciplinary Hearing','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Asive Mdela' and coalesce(event_date_raw,'')=coalesce('28-Jan-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B451','Tadiwanashe Chiyangwa','Nail Tech','BOA Kuilsrivier',date '2026-01-29','29-Jan-26','FEBRUARY 2026','Dismissed by HR','Decision after Disciplinary Hearing','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Tadiwanashe Chiyangwa' and coalesce(event_date_raw,'')=coalesce('29-Jan-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Stravona Ben','Nail Tech','Sandown',date '2026-02-02','2-Feb-26','FEBRUARY 2026','Assessment period failed','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Stravona Ben' and coalesce(event_date_raw,'')=coalesce('2-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Brenda Chibanda','Nail Tech','Durbanville',date '2026-02-02','2-Feb-26','FEBRUARY 2026','Assessment period failed','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Brenda Chibanda' and coalesce(event_date_raw,'')=coalesce('2-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Natasha Alickson','Nail Tech','Sandown',date '2026-02-03','3-Feb-26','FEBRUARY 2026','Assessment period failed','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Natasha Alickson' and coalesce(event_date_raw,'')=coalesce('3-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Precious Masaya','Nail Tech','BOA H/O',date '2026-02-13','13-Feb-26','FEBRUARY 2026','Poor Work Performance','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Precious Masaya' and coalesce(event_date_raw,'')=coalesce('13-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Sharon Vimbhai','Nail Tech','BOA H/O',date '2026-02-13','13-Feb-26','FEBRUARY 2026','Trial Failed','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Sharon Vimbhai' and coalesce(event_date_raw,'')=coalesce('13-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Merciline Samhanga','Nail Tech','BOA H/O',date '2026-02-13','13-Feb-26','FEBRUARY 2026','Trial Failed','Letter issued','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Merciline Samhanga' and coalesce(event_date_raw,'')=coalesce('13-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Merciline Sanhanga','NT Student','BOA H/O',date '2026-02-13','13-Feb-26','FEBRUARY 2026','Assessment period failed','Terminated due to poor work performance whilst on 2week trial','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Merciline Sanhanga' and coalesce(event_date_raw,'')=coalesce('13-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B287','Nakisa (Akeela) Mazhanda','Nail Tech','Seapoint',date '2026-02-19','19-Feb-26','FEBRUARY 2026','Dismissed by HR','Theft / Dishonesty','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Nakisa (Akeela) Mazhanda' and coalesce(event_date_raw,'')=coalesce('19-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Zodwa Mkhatsha','Nail Tech','Training',date '2026-02-20','20-Feb-26','FEBRUARY 2026','Outstanding Docs','Outstanding Docs','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Zodwa Mkhatsha' and coalesce(event_date_raw,'')=coalesce('20-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B794','Nothani Sibanda','Nail Technician','Mushroom Farm',date '2026-02-27','27-Feb-26','FEBRUARY 2026','Fraudulant Documents','Received feedback from Home Affairs regarding Documents received.','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Nothani Sibanda' and coalesce(event_date_raw,'')=coalesce('27-Feb-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination',null,'Mpho Tsolo','CCA','BOA H/O',date '2026-03-03','3-Mar-26','MARCH 2026','Insolence - Disrespectful behaviour and Atitiude towards Manager. Continuous Lateness. Failed to follow company conditions of Service and operating regulations','As the Reason','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Mpho Tsolo' and coalesce(event_date_raw,'')=coalesce('3-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B832','Austen Klaas','Warehouse/Driver','BOA H/O',date '2026-03-19','19-Mar-26','MARCH 2026','Gross Misconduct - Use of cannibus during working hours and on/ infront of the office building.','As reason','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Austen Klaas' and coalesce(event_date_raw,'')=coalesce('19-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B629','Sehlule Ncube','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Sehlule Ncube' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B725','Sehluleli Ncube','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Sehluleli Ncube' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B426','Sindisile Stetema','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Sindisile Stetema' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B757','Brenda Sibanda','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Brenda Sibanda' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B715','Judith Ifu Ekofo','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Judith Ifu Ekofo' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B576','Cosnence Nkosi','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Cosnence Nkosi' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B293','Tariro Mudzinganyama','Nail Technician','Eastgate',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Tariro Mudzinganyama' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B796','Judith Kowo','Nail Technician','Verdi',date '2026-03-19','19-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Judith Kowo' and coalesce(event_date_raw,'')=coalesce('19-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B792','Retshiditsoe Mngadi','Nail Technician','Verdi',date '2026-03-19','19-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Retshiditsoe Mngadi' and coalesce(event_date_raw,'')=coalesce('19-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B842','Goitsemang Ngwenga','Nail Technician','Mushroom Farm',null,'9-Mar-06','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Goitsemang Ngwenga' and coalesce(event_date_raw,'')=coalesce('9-Mar-06',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B843','Concilier Sibanda','Nail Technician','Mushroom Farm',date '2026-03-09','9-Mar-26','APRIL 2026','Invalid Work Permit','n/a','seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Concilier Sibanda' and coalesce(event_date_raw,'')=coalesce('9-Mar-26',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B522','Melisa Mavhunja','NT','Rondebosch',date '2026-07-25','25 July 2026','August 2026','No Valid Work Permit',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Melisa Mavhunja' and coalesce(event_date_raw,'')=coalesce('25 July 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B406','Patuma Halidi','NT','Rondebosch',date '2026-07-25','25 July 2026','August 2026','No Valid Work Permit',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Patuma Halidi' and coalesce(event_date_raw,'')=coalesce('25 July 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B269','Chelsea Gatsi','NT','Rondebosch',date '2026-07-25','25 July 2026','August 2026','No Valid Work Permit',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Chelsea Gatsi' and coalesce(event_date_raw,'')=coalesce('25 July 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B646','Caroline Chandirega','NT','Rondebosch',date '2026-07-25','25 July 2026','August 2026','No Valid Work Permit',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Caroline Chandirega' and coalesce(event_date_raw,'')=coalesce('25 July 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B244','Ngonidzasha Takaya','NT','Rondebosch',date '2026-07-25','25 July 2026','August 2026','No Valid Work Permit',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Ngonidzasha Takaya' and coalesce(event_date_raw,'')=coalesce('25 July 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B974','Sivashney Williams','NT','Winelands',date '2026-08-19','19 August 2026','August 2026','Serious/Unprofessional Conduct displayed, Inappropriate and Direspectful Conduct Towards Clients, Disruptive and COnfrontational Behaviour in the Workplace, Failure to Maintain Required Customer-Service Standards, Creating Conflict and Disruption Amoungst Employees, Failure to COnduct Herself in a Professional Manner, Failure to Follow Reasonable Manageable Instructions.',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Sivashney Williams' and coalesce(event_date_raw,'')=coalesce('19 August 2026',''));
insert into hr_tracker_records (kind,separation_type,employee_code,employee_name,role_title,location,event_date,event_date_raw,month_band,reason,notes,source)
select 'termination','termination','B499','Caitlin Theunissen','NT','Durbanville',date '2026-08-19','19 August 2026','August 2026','Unauthorised Possession of Another Employee''s Property / Dishonesty and Misrepresentation, and Theft',null,'seed'
where not exists (select 1 from hr_tracker_records where kind='termination' and employee_name='Caitlin Theunissen' and coalesce(event_date_raw,'')=coalesce('19 August 2026',''));
