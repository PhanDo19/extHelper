// Mapping goi y cho co so parisnhon.
// stockCode la ma trong file Kho HG; ma web cua co so nay co dinh dang 0000001,
// khac han 1000001/1100019 cua hai co so kia nen khong dung chung bat cu bang
// tra nao theo tien to ma.
// 27/32 dong ghep duoc theo ten + don vi + gia; 5 dong can chon tay.
// KHONG dong nao o trang thai confirmed: viec xac nhan la cua ke toan.
(function (root) {
  "use strict";
  root.InvoiceMappingParisNhon = {
    "source": "Kho HG tháng 7.xlsx + mat_hang_web_NHOn.xlsx",
    "tenant": "parisnhon",
    "generatedAt": "2026-09-03",
    "mappings": [
      {
        "stockCode": "HH_Banhquyque",
        "stockName": "Bánh quy que với cốc Sô cô la",
        "stockUnit": "Hộp",
        "stockQty": 185,
        "conversion": 1,
        "availableQty": 185,
        "salePrice": 60000,
        "webCode": "0000001",
        "webName": "Bánh que",
        "webUnit": "gói",
        "webPrice": 60000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000001",
            "webName": "Bánh que",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Bokho70gr",
        "stockName": "Bò khô nguyên tảng - gói 70g",
        "stockUnit": "Gói",
        "stockQty": 302,
        "conversion": 1,
        "availableQty": 302,
        "salePrice": 250000,
        "webCode": "0000007",
        "webName": "Bò khô miếng",
        "webUnit": "gói",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 250000 khác giá web 90000",
        "suggestions": [
          {
            "webCode": "0000007",
            "webName": "Bò khô miếng",
            "reason": "Giá kho 250000 khác giá web 90000"
          }
        ]
      },
      {
        "stockCode": "HH_Changa",
        "stockName": "Chân gà cay",
        "stockUnit": "Gói",
        "stockQty": 288,
        "conversion": 1,
        "availableQty": 288,
        "salePrice": 55000,
        "webCode": "",
        "webName": "",
        "webUnit": "",
        "webPrice": 0,
        "webType": "",
        "webGroup": "",
        "status": "unmatched",
        "confidence": 0,
        "confirmedAt": "",
        "reviewNote": "Hai ứng viên: 0000009 Chân gà (ĐVT+giá khớp) hoặc 0000042 Chân gà cay (tên khớp). Cần chọn tay.",
        "suggestions": []
      },
      {
        "stockCode": "HH_Coca330ml",
        "stockName": "Coca lon 330ml",
        "stockUnit": "Lon",
        "stockQty": 120,
        "conversion": 1,
        "availableQty": 120,
        "salePrice": 30000,
        "webCode": "",
        "webName": "",
        "webUnit": "",
        "webPrice": 0,
        "webType": "",
        "webGroup": "",
        "status": "unmatched",
        "confidence": 0,
        "confirmedAt": "",
        "reviewNote": "Danh mục web không có Coca. Các mã trùng giá 30.000 đều là hàng khác.",
        "suggestions": []
      },
      {
        "stockCode": "HH_Collagen",
        "stockName": "Nước uống girl collagen",
        "stockUnit": "Lon",
        "stockQty": 582,
        "conversion": 1,
        "availableQty": 582,
        "salePrice": 90000,
        "webCode": "0000086",
        "webName": "Collagen",
        "webUnit": "chai",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "SETUP TẠI PHÒNG",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000086",
            "webName": "Collagen",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Corona250ml",
        "stockName": "Bia CORONA 250ml",
        "stockUnit": "Chai",
        "stockQty": 1370,
        "conversion": 1,
        "availableQty": 1370,
        "salePrice": 65000,
        "webCode": "0000003",
        "webName": "Bia Corona Extra 250ml",
        "webUnit": "chai",
        "webPrice": 65000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "BIA - RƯỢU",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000003",
            "webName": "Bia Corona Extra 250ml",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Daheotoiot",
        "stockName": "Da heo Lucky Star vị tỏi ớt 25g",
        "stockUnit": "Gói",
        "stockQty": 89,
        "conversion": 1,
        "availableQty": 89,
        "salePrice": 45000,
        "webCode": "0000037",
        "webName": "Da heo vị các loại",
        "webUnit": "gói",
        "webPrice": 45000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000037",
            "webName": "Da heo vị các loại",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Dongtrunghathao",
        "stockName": "Nước tinh chất đông trùng hạ thảo",
        "stockUnit": "Gói",
        "stockQty": 341,
        "conversion": 1,
        "availableQty": 341,
        "salePrice": 90000,
        "webCode": "0000073",
        "webName": "Đông trùng",
        "webUnit": "gói",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000073",
            "webName": "Đông trùng",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Gaxe60gr",
        "stockName": "Gà xé nướng Tây Bắc 60g",
        "stockUnit": "Gói",
        "stockQty": 106,
        "conversion": 1,
        "availableQty": 106,
        "salePrice": 90000,
        "webCode": "0000084",
        "webName": "Khô gà",
        "webUnit": "gói",
        "webPrice": 45000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 90000 khác giá web 45000",
        "suggestions": [
          {
            "webCode": "0000084",
            "webName": "Khô gà",
            "reason": "Giá kho 90000 khác giá web 45000"
          }
        ]
      },
      {
        "stockCode": "HH_Hatmaca",
        "stockName": "Hạt macadamia",
        "stockUnit": "Gói",
        "stockQty": 362,
        "conversion": 1,
        "availableQty": 362,
        "salePrice": 75000,
        "webCode": "0000085",
        "webName": "Hạt Macca",
        "webUnit": "gói",
        "webPrice": 75000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000085",
            "webName": "Hạt Macca",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Heneiken",
        "stockName": "Bia Heineken lon 330ml",
        "stockUnit": "Lon",
        "stockQty": 9316,
        "conversion": 1,
        "availableQty": 9316,
        "salePrice": 60000,
        "webCode": "0000004",
        "webName": "Bia Ken Lon",
        "webUnit": "chai",
        "webPrice": 60000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "BIA - RƯỢU",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000004",
            "webName": "Bia Ken Lon",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Huyen",
        "stockName": "Hũ yến",
        "stockUnit": "Hũ",
        "stockQty": 341,
        "conversion": 1,
        "availableQty": 341,
        "salePrice": 90000,
        "webCode": "0000027",
        "webName": "Nước Yến (lọ)",
        "webUnit": "Lọ",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "SETUP TẠI PHÒNG",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000027",
            "webName": "Nước Yến (lọ)",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Ionkiem",
        "stockName": "Nước ion kiềm",
        "stockUnit": "Chai",
        "stockQty": 4824,
        "conversion": 1,
        "availableQty": 4824,
        "salePrice": 25000,
        "webCode": "0000097",
        "webName": "Nước ion kiềm",
        "webUnit": "chai",
        "webPrice": 25000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "BIA - RƯỢU",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000097",
            "webName": "Nước ion kiềm",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Jacker150g",
        "stockName": "Bánh khoai tây chiên Jacker các vị 150g",
        "stockUnit": "Lon",
        "stockQty": 126,
        "conversion": 1,
        "availableQty": 126,
        "salePrice": 120000,
        "webCode": "",
        "webName": "",
        "webUnit": "",
        "webPrice": 0,
        "webType": "",
        "webGroup": "",
        "status": "unmatched",
        "confidence": 0,
        "confirmedAt": "",
        "reviewNote": "Web chỉ có 0000015 Khoai tây hộp (70.000), đã dùng cho bản 60g. Cần tạo mã web cho bản 150g.",
        "suggestions": []
      },
      {
        "stockCode": "HH_Jacker60gr",
        "stockName": "Bánh khoai tây chiên Jacker các vị 60g",
        "stockUnit": "Lon",
        "stockQty": 231,
        "conversion": 1,
        "availableQty": 231,
        "salePrice": 70000,
        "webCode": "0000015",
        "webName": "Khoai tây hộp",
        "webUnit": "hộp",
        "webPrice": 70000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "SETUP TẠI PHÒNG",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000015",
            "webName": "Khoai tây hộp",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_KeongamDM",
        "stockName": "Kẹo ngậm DM các vị tuýp 35 viên",
        "stockUnit": "Hộp",
        "stockQty": 96,
        "conversion": 1,
        "availableQty": 96,
        "salePrice": 75000,
        "webCode": "0000062",
        "webName": "Kẹo Bạc Hà",
        "webUnit": "Lọ",
        "webPrice": 75000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000062",
            "webName": "Kẹo Bạc Hà",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_KhanuotV1020",
        "stockName": "Khăn ướt in máy màng bạc V1020",
        "stockUnit": "Cái",
        "stockQty": 99616.4,
        "conversion": 1,
        "availableQty": 99616,
        "salePrice": 5000,
        "webCode": "0000014",
        "webName": "Khăn ướt",
        "webUnit": "Cái",
        "webPrice": 5000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "SETUP TẠI PHÒNG",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000014",
            "webName": "Khăn ướt",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Mix",
        "stockName": "Bánh que Mix vị",
        "stockUnit": "Gói",
        "stockQty": 665,
        "conversion": 1,
        "availableQty": 665,
        "salePrice": 45000,
        "webCode": "0000098",
        "webName": "Bánh que Mix",
        "webUnit": "gói",
        "webPrice": 40000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 45000 khác giá web 40000",
        "suggestions": [
          {
            "webCode": "0000098",
            "webName": "Bánh que Mix",
            "reason": "Giá kho 45000 khác giá web 40000"
          }
        ]
      },
      {
        "stockCode": "HH_Nuochacsam",
        "stockName": "Nước hắc sâm Hàn Quốc",
        "stockUnit": "Gói",
        "stockQty": 93,
        "conversion": 1,
        "availableQty": 93,
        "salePrice": 90000,
        "webCode": "0000078",
        "webName": "Nước hắc sâm Hàn Quốc",
        "webUnit": "gói",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000078",
            "webName": "Nước hắc sâm Hàn Quốc",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Pillowscavi",
        "stockName": "Snack Pillows các vị",
        "stockUnit": "Gói",
        "stockQty": 341,
        "conversion": 1,
        "availableQty": 341,
        "salePrice": 45000,
        "webCode": "0000095",
        "webName": "Snack Pillows các vị",
        "webUnit": "gói",
        "webPrice": 45000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000095",
            "webName": "Snack Pillows các vị",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Rongbien",
        "stockName": "Rong biển nướng truyền thống",
        "stockUnit": "Gói",
        "stockQty": 573,
        "conversion": 1,
        "availableQty": 573,
        "salePrice": 30000,
        "webCode": "0000031",
        "webName": "Quẩy rong biển",
        "webUnit": "gói",
        "webPrice": 50000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 30000 khác giá web 50000",
        "suggestions": [
          {
            "webCode": "0000031",
            "webName": "Quẩy rong biển",
            "reason": "Giá kho 30000 khác giá web 50000"
          }
        ]
      },
      {
        "stockCode": "HH_SaigonSilverCapsule",
        "stockName": "Thuốc lá Saigon Silver Capsule DSBC",
        "stockUnit": "Bao",
        "stockQty": 96,
        "conversion": 1,
        "availableQty": 96,
        "salePrice": 70000,
        "webCode": "",
        "webName": "",
        "webUnit": "",
        "webPrice": 0,
        "webType": "",
        "webGroup": "",
        "status": "unmatched",
        "confidence": 0,
        "confirmedAt": "",
        "reviewNote": "Web không có Saigon Silver. Mã 0000044 Thuốc lá Camel trùng giá 70.000 nhưng là sản phẩm khác.",
        "suggestions": []
      },
      {
        "stockCode": "HH_SaigonSilverDemiSlimBC",
        "stockName": "Thuốc lá Saigon Silver Demi Slim BC",
        "stockUnit": "Bao",
        "stockQty": 43,
        "conversion": 1,
        "availableQty": 43,
        "salePrice": 80000,
        "webCode": "",
        "webName": "",
        "webUnit": "",
        "webPrice": 0,
        "webType": "",
        "webGroup": "",
        "status": "unmatched",
        "confidence": 0,
        "confirmedAt": "",
        "reviewNote": "Web không có Saigon Silver. Mã 0000038/0000039 trùng giá 80.000 nhưng là sản phẩm khác.",
        "suggestions": []
      },
      {
        "stockCode": "HH_SnackOishi",
        "stockName": "Snack Oishi các loại",
        "stockUnit": "Gói",
        "stockQty": 830,
        "conversion": 1,
        "availableQty": 830,
        "salePrice": 40000,
        "webCode": "0000096",
        "webName": "Snack Oishi các loại",
        "webUnit": "gói",
        "webPrice": 40000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000096",
            "webName": "Snack Oishi các loại",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_ThanglongBC",
        "stockName": "Thuốc lá Thăng Long BC",
        "stockUnit": "Bao",
        "stockQty": 147,
        "conversion": 1,
        "availableQty": 147,
        "salePrice": 35000,
        "webCode": "0000061",
        "webName": "Thuốc lá Thăng Long",
        "webUnit": "bao",
        "webPrice": 35000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "THUỐC LÁ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000061",
            "webName": "Thuốc lá Thăng Long",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_ThanglongBM",
        "stockName": "Thuốc lá Thăng Long BM",
        "stockUnit": "Bao",
        "stockQty": 162,
        "conversion": 1,
        "availableQty": 162,
        "salePrice": 35000,
        "webCode": "0000061",
        "webName": "Thuốc lá Thăng Long",
        "webUnit": "bao",
        "webPrice": 35000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "THUỐC LÁ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000061",
            "webName": "Thuốc lá Thăng Long",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_ThanglongSlim",
        "stockName": "Thuốc lá điếu Thăng Long Slim bao cứng",
        "stockUnit": "Bao",
        "stockQty": 48,
        "conversion": 1,
        "availableQty": 48,
        "salePrice": 50000,
        "webCode": "0000061",
        "webName": "Thuốc lá Thăng Long",
        "webUnit": "bao",
        "webPrice": 35000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "THUỐC LÁ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 50000 khác giá web 35000",
        "suggestions": [
          {
            "webCode": "0000061",
            "webName": "Thuốc lá Thăng Long",
            "reason": "Giá kho 50000 khác giá web 35000"
          }
        ]
      },
      {
        "stockCode": "HH_Thophuclinh",
        "stockName": "Nước uống thảo dược Thổ phục linh",
        "stockUnit": "Chai",
        "stockQty": 442,
        "conversion": 1,
        "availableQty": 442,
        "salePrice": 85000,
        "webCode": "0000025",
        "webName": "Nước uống thảo dược Thổ phục linh",
        "webUnit": "chai",
        "webPrice": 90000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "SETUP TẠI PHÒNG",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 85000 khác giá web 90000",
        "suggestions": [
          {
            "webCode": "0000025",
            "webName": "Nước uống thảo dược Thổ phục linh",
            "reason": "Giá kho 85000 khác giá web 90000"
          }
        ]
      },
      {
        "stockCode": "HH_Tigerbac330ml",
        "stockName": "Bia Tiger bạc lon 330ml",
        "stockUnit": "Chai",
        "stockQty": 9212,
        "conversion": 1,
        "availableQty": 9212,
        "salePrice": 50000,
        "webCode": "0000045",
        "webName": "Bia Tiger lon",
        "webUnit": "Lon",
        "webPrice": 50000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "BIA - RƯỢU",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000045",
            "webName": "Bia Tiger lon",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Topmocuonchaytoi",
        "stockName": "Tóp mỡ cuộn cháy tỏi 30g",
        "stockUnit": "Gói",
        "stockQty": 68,
        "conversion": 1,
        "availableQty": 68,
        "salePrice": 80000,
        "webCode": "0000082",
        "webName": "Tóp mỡ cuộn cháy tỏi",
        "webUnit": "gói",
        "webPrice": 75000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.5,
        "confirmedAt": "",
        "reviewNote": "Giá kho 80000 khác giá web 75000",
        "suggestions": [
          {
            "webCode": "0000082",
            "webName": "Tóp mỡ cuộn cháy tỏi",
            "reason": "Giá kho 80000 khác giá web 75000"
          }
        ]
      },
      {
        "stockCode": "HH_Wewell",
        "stockName": "Wewell Maxfit",
        "stockUnit": "Lon",
        "stockQty": 92,
        "conversion": 1,
        "availableQty": 92,
        "salePrice": 80000,
        "webCode": "0000094",
        "webName": "Wewell Maxfit",
        "webUnit": "Lon",
        "webPrice": 80000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000094",
            "webName": "Wewell Maxfit",
            "reason": "Tên và giá bán khớp"
          }
        ]
      },
      {
        "stockCode": "HH_Xucxich",
        "stockName": "Xúc Xích Tiệt Trùng",
        "stockUnit": "Cái",
        "stockQty": 287,
        "conversion": 1,
        "availableQty": 287,
        "salePrice": 50000,
        "webCode": "0000041",
        "webName": "Xúc xích",
        "webUnit": "gói",
        "webPrice": 50000,
        "webType": "Mặt hàng kiêm vật tư",
        "webGroup": "ĐỒ KHÔ",
        "status": "review",
        "confidence": 0.8,
        "confirmedAt": "",
        "reviewNote": "Tên và giá bán khớp",
        "suggestions": [
          {
            "webCode": "0000041",
            "webName": "Xúc xích",
            "reason": "Tên và giá bán khớp"
          }
        ]
      }
    ]
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
