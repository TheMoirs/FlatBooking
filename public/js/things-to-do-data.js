// Data for the Things To Do page — sourced from the Moirs' own list, with
// real website and map links extracted from the original document.
const THINGS_TO_DO = {
  restaurants: {
    title: "Restaurants",
    intro: "There are loads, but here's a few.",
    groups: [
      {
        heading: "Pricey, but great food",
        items: [
          { name: "Dos Leones", note: "Great steaks — next door to the left", map: "https://goo.gl/maps/eqJCJpf9dHm11PJt9" },
          { name: "Da Bruno a Cabopino", note: "6 mins by car", site: "https://www.dabruno.com/en-cabopino", map: "https://g.page/restaurante-en-marbella?share" },
          { name: "La Pergola", note: "Italian, Torrenueva — 8 mins by car", site: "https://lapergolalacala.com/", map: "https://goo.gl/maps/CAJ7kCVp4pm5Mmed9" },
          { name: "Geranium", note: "La Cala — 10 mins by car", site: "https://thenewgeranium.com/", map: "https://maps.app.goo.gl/2uhDwaodF1Hq4ruQ8" }
        ]
      },
      {
        heading: "Reasonable prices",
        items: [
          { name: "Restaurante La Siesta Golf", note: "Next door to the right", map: "https://goo.gl/maps/cfQBnwptaa4KvW437" },
          { name: "Myel y Nata", note: "Huge portions — 2 mins by car, 12 mins on foot", map: "https://goo.gl/maps/4YjKCA1aH5bwZvsB9" },
          { name: "Luna Beach Calahonda", note: "8 mins by car", site: "https://lunabeachrestaurante.com/", map: "https://g.page/lunabeachcalahonda?share" },
          { name: "Da Vinci & 5 other restaurants at Dona Lola", note: "Italian and more — 5 mins by car", map: "https://g.page/MesonDonaLolaCalahonda?share" },
          { name: "Jammy Olive", note: "Great for breakfast — 5 mins by car", map: "https://goo.gl/maps/tf8uEYfY2fGzStGp8" },
          { name: "El Olivo", note: "La Cala — 10 mins by car", site: "https://elolivodelacala.com/en/home/", map: "https://goo.gl/maps/tScyrDTeYv8a3hYZ8" }
        ]
      }
    ]
  },
  bars: {
    title: "Bars",
    intro: "There are loads, but here's a few.",
    groups: [
      {
        heading: null,
        items: [
          { name: "Harp Bar", note: "The Strip, Calahonda — sports & pool tables — 15 min walk down the hill", site: "https://www.facebook.com/harpbar.calahonda.mijas/?locale=en_GB", map: "https://maps.app.goo.gl/s9YDSzUSEcq8R8FT9" },
          { name: "Millenium Cocktail Bar", note: "Live music, sports, pool table & large measures — 10 min walk up the hill", site: "https://www.facebook.com/milleniumcalahonda/", map: "https://maps.app.goo.gl/BgLBW7Kp9Bwukr5u5" },
          { name: "Pals Bar", note: "El Zoco — 30 min walk down the hill", site: "https://www.facebook.com/p/Pals-Bar-100057383812341/", map: "https://maps.app.goo.gl/ZgQiQDtapuW1QuBP8" },
          { name: "Pura Cepa", note: "La Cala — great for pre-dinner gins — 10 mins by car", site: "https://www.facebook.com/puracepagrupo/", map: "https://maps.app.goo.gl/Qqd1vt8VysAQ8neJ9" }
        ]
      }
    ]
  },
  activities: {
    title: "Activities",
    intro: "",
    groups: [
      { heading: null, items: [
        { name: "La Siesta Golf", note: "9-hole Pitch & Putt (€22) plus driving range — next door", site: "https://www.clubdegolflasiesta.com/" },
        { name: "Club del Sol", note: "Tennis, squash, gym & cafe — across the road", site: "https://www.tenniscostadelsol.com/" }
      ]},
      { heading: "Beaches", items: [
        { name: "El Bombo Beach", note: "Water sports & beach restaurants — 6 mins by car, or 1 hr walk", map: "https://goo.gl/maps/XA3Zxzz4Q7HtoKqK8" },
        { name: "Luna Beach & restaurant", note: "8 mins by car, or 50 min walk", map: "https://g.page/lunabeachcalahonda?share" },
        { name: "La Cala Beach", note: "Boules piste & restaurants — 9 mins by car, or 1 hr 15 min walk", map: "https://goo.gl/maps/691FA7Bp2oh2u5eA9" },
        { name: "Cabopino (Andy's) beach", note: "Marina & restaurants — 7 mins by car, or 1 hr walk", map: "https://goo.gl/maps/xHMSbUNLbJGgch58A" }
      ]},
      { heading: "Shopping", items: [
        { name: "Miramar Shopping Mall, Fuengirola", note: "15 mins by car", site: "https://www.miramarcc.com/en/", map: "https://goo.gl/maps/CMCrQ1ezhfgrMEuT6" },
        { name: "McArthur Glen Designer Outlet, Malaga", note: "30 mins by car", site: "https://www.mcarthurglen.com/en/outlets/es/designer-outlet-malaga/", map: "https://maps.app.goo.gl/YVHRsWJdb8sSRUT2A" },
        { name: "La Canada Shopping Mall, Marbella", note: "20 mins by car", site: "https://lacanadashopping.com/", map: "https://maps.app.goo.gl/kLQWhwPYYZTXMtse9" }
      ]},
      { heading: null, items: [
        { name: "Mijas Pueblo", note: "Pretty white village to walk around, eat & drink — 25 mins by car", site: "https://www.tripadvisor.co.uk/Attractions-g4424512-Activities-Mijas_Pueblo_Mijas_Costa_del_Sol_Province_of_Malaga_Andalucia.html", map: "https://www.google.com/maps/place/Mijas+Pueblo,+29650+Mijas,+M%C3%A1laga,+Spain/@36.5963609,-4.6417572,16z" },
        { name: "Mijas Pueblo Walking Tour", note: "About €10 — WhatsApp Alan Boardman +34 610 522605", site: "https://www.facebook.com/mijaswalkingtours" },
        { name: "Visit Marbella", note: "Shops, restaurants, Old Town & marina — 20 mins by car", map: "https://goo.gl/maps/h9N5pKqvxjhBamSN8" },
        { name: "Visit Puerto Banus", note: "Shops, restaurants & marina — 25 mins by car (or ferry from Marbella)", map: "https://goo.gl/maps/LYZ82w9n5RjSRc2EA" },
        { name: "Ferry between Marbella & Puerto Banus", note: "About €20 — 20 mins by car", site: "https://www.fly-blue.com/en/", map: "https://goo.gl/maps/StGFFnBo9bFwxJBL9" },
        { name: "Electric bike guided tour of Puerto Banus & Marbella Old Town", note: "20 mins by car", site: "https://costadeluxe.es/tour-bicicleta-electrica-marbella-de-lujo/" },
        { name: "Scuba Diving with Nic", note: "15 mins by car", site: "https://divingwithnic.com/", map: "https://goo.gl/maps/s2m2M9qZ7mzDw7DLA" },
        { name: "Mijas Aqua Park", note: "15 mins by car", site: "https://aquamijas.com/", map: "https://g.page/parqueaquamijas?share" },
        { name: "Segway Tours", note: "About €50 — in Malaga — 45 mins by car", site: "https://www.getyourguide.com/en-gb/malaga-l402/malaga-complete-city-highlights-segway-tour-t313563/" },
        { name: "Bigfoot Buggytours", note: "20 mins by car", site: "https://bigfootbuggytours.com/", map: "https://maps.app.goo.gl/K47jArPnKLurY49q9" },
        { name: "Quad Bikes Tour from Fuengirola", note: "15 mins by car", site: "https://aventouralia.com/en/", map: "https://maps.app.goo.gl/SBjv1Dw8Zo9fw4wu9" },
        { name: "Marbella Jet Ski", note: "Plus pedalos, banana boats, paddle boards etc — 15 mins by car", site: "https://marbellajetski.com/", map: "https://goo.gl/maps/VxndUUzbdr9ftPrD7" },
        { name: "Golf Courses", note: "There are loads! Need to pre-book well in advance", site: "https://www.costalessgolf.com/lowest-green-fees/?tour_destination=costa-del-sol" },
        { name: "Bikestardo", note: "Bike hire, tracks & guided tours — will deliver to flat", site: "https://www.bikestardo.com/Tracks" },
        { name: "Legends Showbar, La Cala", note: "Music tributes — 10 mins by car", site: "https://www.facebook.com/legendslacala/", map: "https://goo.gl/maps/kBW3cCtXBXsHKR627" },
        { name: "The Casbah Live Lounge, Torrenueva", note: "8 mins by car", site: "https://m.facebook.com/TheCazbahLiveLounge", map: "https://maps.app.goo.gl/TLnaWXSYambR249eA" }
      ]},
      { heading: "Day trips", items: [
        { name: "Gibraltar", note: "Cable car ride — 1 hr 20 mins by car", site: "https://www.visitgibraltar.gi/", map: "https://goo.gl/maps/HdZMwYHU2o5qEVEfA" },
        { name: "Cordoba", note: "2 hours by car", site: "https://www.spain.info/en/destination/cordoba/", map: "https://maps.app.goo.gl/XZXKdS97DNNPSk6W9" },
        { name: "Ronda", note: "1 hr 20 mins by car", site: "https://www.andalucia.org/en/ronda", map: "https://maps.app.goo.gl/Qxc2gYFGMqNkbmuu7" },
        { name: "El Caminito del Rey", note: "€10, or €18 with guide — walkway pinned along the walls of a narrow gorge — 1 hr 10 mins by car. Park at South Exit (El Chorro) & get the bus to the North Exit (start), so you finish at your car.", site: "https://www.caminitodelrey.info/en/tickets/buy", map: "https://goo.gl/maps/6B4eXETFxDZBmFBi7" },
        { name: "Setenil de las Bodegas", note: "Unique white village — 1.5 hrs drive away", site: "https://www.saltinourhair.com/spain/setenil-de-las-bodegas/" },
        { name: "Nerja Caves", note: "€18 each — 1 hr 15 mins by car", site: "https://cuevadenerja.es/en/", map: "https://www.google.com/maps/place/Fundaci%C3%B3n+Cueva+de+Nerja/@36.7616268,-3.8505877,16z" }
      ]},
      { heading: null, items: [
        { name: "Visit Malaga Old Town & castle", note: "45 mins by car", map: "https://goo.gl/maps/cWZAo21Prijxd5tVA" }
      ]},
      { heading: "Wine tours", items: [
        { name: "Malaga Wine & Tapas Tour", note: "About €65 for 2.5 hours — 45 mins by car", site: "https://www.getyourguide.co.uk/malaga-l402/malaga-wine-and-tapas-tour-with-tastings-and-drinks-t425367/" },
        { name: "Malaga Tapas Crawl", note: "€75 for 3 hours", site: "https://www.getyourguide.co.uk/malaga-l402/malaga-tapas-crawl-t345196/" },
        { name: "Winery tour with lunch", note: "About €25 — 1 hr 15 mins by car", site: "https://bodegasbentomiz.com/tours-tastings-lunches/" },
        { name: "Marbella Old Town wine & tapas tour", note: "About €90 for 3 hours", site: "https://www.getyourguide.com/en-gb/marbella-l1217/marbella-tapas-and-walking-tour-through-the-historic-centre-t605710/" }
      ]},
      { heading: null, items: [
        { name: "Horse riding on the beach, Torremolinos", note: "Cortijo el Moral, from €45 — 30 mins by car", site: "https://cortijomoral.com/", map: "https://maps.app.goo.gl/k4pGaWx6iUW8r2nH6" },
        { name: "Ride in Spain, Malaga", note: "", site: "https://ride-in-spain.com/" },
        { name: "La Cala market at the fairground", note: "9am–2pm, every Wed & Sat — 10 mins by car", map: "https://maps.app.goo.gl/rnWDoSHWKD7YsUfB7" }
      ]},
      { heading: "Massage & facials", items: [
        { name: "La Cala Golf Spa", note: "", site: "https://www.lacala.com/bookings/" },
        { name: "Spa treatments at Oceano Hotel", note: "", site: "https://www.oceanohotel.com/beauty-salon/treatments-prices" }
      ]},
      { heading: null, items: [
        { name: "Dolphin sightseeing boat tour, Fuengirola", note: "€38 for 2 hrs, inc. drinks/snacks — 20 mins by car", site: "https://www.sailbombay.com/", map: "https://maps.app.goo.gl/9q9BfRvg1SsVJwms7" },
        { name: "Beach clubs with pool, bar & restaurant", note: "Max Beach, Riviera & Unico Beach Club, La Cala", site: "https://www.maxbeach.es/" },
        { name: "Kitesurfing Lessons — Marbella Kite School", note: "" },
        { name: "Walk the boardwalk (Senda Litoral), La Cala to Cabopino", note: "About 7km (1.5 hrs) each way", site: "https://visitfuengirola.com/hike-on-the-senda-litoral-from-mijas-to-cabopino/" },
        { name: "Crazy Golf, Fuengirola", note: "18 mins by car", site: "https://fuengirolaadventuregolf.com/", map: "https://maps.app.goo.gl/Pvfs8YmjaZrwQtGRA" },
        { name: "Mijas Grand Park", note: "Children's play area, skate park, running track, pétanque pistes, lakes — 20 min drive", map: "https://maps.app.goo.gl/3eQuoSMFyNLsemt39" },
        { name: "Zip Line & Adventure Park, Malaga", note: "40 mins by car", site: "https://sunviewpark.com/", map: "https://maps.app.goo.gl/aMt921afadLuKc2P9" }
      ]}
    ]
  }
};
