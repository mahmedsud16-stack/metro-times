# مواعيد المترو — نسخة ويب مستقلة (GitHub Pages)

تطبيق ويب ثابت (HTML/CSS/JS بدون خطوة بناء) يعرض مواعيد قطارات مترو واشنطن
(WMATA) المباشرة. بُني لأن تحديد الموقع لا يصل إلى التطبيق داخل عرض Muse،
بينما المتصفح الحقيقي (HTTPS + طلب إذن) يمنحه.

الموقع المباشر: https://mahmedsud16-stack.github.io/metro-times/

## المزايا (مطابقة لتطبيق الأرتيفاكت الأصلي)

- 98 محطة: أقرب محطة من موقع GPS، بحث بالاسم/الرمز، فلتر حسب الخط، مفضلة.
- مواعيد WMATA المباشرة (StationPrediction GetPrediction) مع تحديث تلقائي كل 30 ثانية.
- شاشة إدخال مفتاح WMATA عند عدم وجود مفتاح محفوظ؛ المفتاح يُحفظ في
  localStorage على جهاز المستخدم فقط، ولا يوجد أي مفتاح مضمّن في الكود.
- الموقع: لا تحديد تلقائي عند الفتح؛ مهلة إجمالية واحدة 25 ثانية؛ زر
  «إيقاف البحث»؛ رسائل فشل محددة (مرفوض/مهلة/غير متاح/غير مدعوم)؛
  «موقعي» المحفوظ لكل محطة، ويُستخدم تلقائيًا عند فشل GPS.
- الإعدادات الافتراضية الأولية من تطبيق الأرتيفاكت: المفضلة
  N12 (Ashburn)، C04 (Foggy Bottom-GWU)، C03 (Farragut West)؛
  المحطة المختارة C04؛ لا يوجد موقع محفوظ في البداية.

## مصدر بيانات المحطات (98 محطة — رمز، اسم، خطوط، إحداثيات)

جُمعت من مصدرين عامين وتمت مطابقتهما:

1. **جدول رموز المحطات** (الاسم، الخطوط، الرمز) من مشروع
   VolpeUSDOT/NPS-Emerging-Mobility على GitHub
   (Transit Boards/WMATA/README.md — جدول «DC Metro Station Codes»
   + قسم «Silver Line Phase II Stations»، مع إضافة محطة Potomac Yard
   C11، Blue/Yellow، التي افتُتحت عام 2023 وغابت عن الجدول).
2. **الإحداثيات** من OpenStreetMap عبر Overpass API
   (عقد `railway=station` للمشغّل Washington Metropolitan Area Transit
   Authority في منطقة واشنطن، + عقدة Downtown Largo المنفصلة)،
   وأُخذ متوسط إحداثيات المحطات ذات العقدتين (Fort Totten،
   Gallery Place، L'Enfant Plaza، Metro Center).
3. طُبّقت أسماء WMATA الرسمية الحالية (تغييرات 2022): North Bethesda
   (كانت White Flint)، Hyattsville Crossing (كانت Prince George's Plaza)،
   Downtown Largo (كانت Largo Town Center)، Tysons (كانت Tysons Corner)،
   Dulles International Airport، Gallery Place، Archives، Mount Vernon
   Square، U Street.

## التحقق من البيانات

- العدد الإجمالي: **98 محطة** (97 اسمًا فريدًا من جدول Volpe + محطة
  Potomac Yard)؛ لا توجد أسماء غير مطابقة بين المصدرين بعد المطابقة.
- فحوصات نقطية (الرمز = الاسم = الخطوط = الإحداثيات معقولة):
  N12 Ashburn (SV)، C04 Foggy Bottom-GWU (BL/OR/SV)، C03 Farragut West
  (BL/OR/SV)، A01 Metro Center (RD)، C01 Metro Center (BL/OR/SV)،
  B01 Gallery Place (RD)، F01 Gallery Place (GR/YL)، D03 L'Enfant Plaza
  (BL/OR/SV)، F03 L'Enfant Plaza (GR/YL)، B03 Union Station (RD)،
  A15 Shady Grove (RD).
- نطاق الإحداثيات: خط عرض 38.77–39.12، خط طول -77.49–-76.84 (منطقة مترو واشنطن).
- المحطات الانتقالية الأربع (Metro Center، Gallery Place، Fort Totten،
  L'Enfant Plaza) مدخلة مرة واحدة لكل محطة مع رمزيها وخطوطها مجمّعة؛
  وتُجلب المواعيد من كل رموز المحطة وتُدمج.

## الاستضافة

GitHub Pages (مستودع عام `mahmedsud16-stack/metro-times`، فرع main،
مجلد الجذر). لا توجد أسرار في المستودع — بيانات المحطات + الكود فقط.

## ملاحظات تقنية

- استدعاء WMATA مباشر من المتصفح: `api.wmata.com` يرسل
  `Access-Control-Allow-Origin: *` ويسمح بترويسة `api_key` (تم التحقق
  2026-11-09) — لا حاجة لأي وسيط (proxy).
- المحطات الانتقالية: تُستدعى المواعيد لكل رموز المحطة وتُدمج مع إزالة
  التكرار والترتيب حسب الدقائق (ARR/BRD أولًا).
