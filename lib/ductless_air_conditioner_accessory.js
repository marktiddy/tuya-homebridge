const BaseAccessory = require("./base_accessory");

let Accessory;
let Service;
let Characteristic;
let UUIDGen;

// Based off Fan V2
const DEFAULT_SPEED_COUNT = 3;
class DuctlessAirConditionerAccessory extends BaseAccessory {
  constructor(platform, homebridgeAccessory, deviceConfig) {
    ({ Accessory, Characteristic, Service } = platform.api.hap);
    super(
      platform,
      homebridgeAccessory,
      deviceConfig,
      Accessory.Categories.FAN,
      Service.Fanv2,
    );
    this.statusArr = deviceConfig.status ? deviceConfig.status : [];
    this.functionArr = deviceConfig.functions ? deviceConfig.functions : [];

    this.addLightService();
    this.addHumiditySensor();
    this.addModeSwitches();
    this.addAccessoryInformation();
    this.refreshAccessoryServiceIfNeed(this.statusArr, false);
  }

  addLightService() {
    this.lightStatus = this.statusArr.find((item, index) => {
      return item.code === "light" && typeof item.value === "boolean";
    });
    if (this.lightStatus) {
      // Service
      this.lightService = this.homebridgeAccessory.getService(
        Service.Lightbulb,
      );
      if (this.lightService) {
        this.lightService.setCharacteristic(
          Characteristic.Name,
          this.deviceConfig.name + " Light",
        );
      } else {
        // add new service
        this.lightService = this.homebridgeAccessory.addService(
          Service.Lightbulb,
          this.deviceConfig.name + " Light",
        );
      }
    }
  }

  addHumiditySensor() {
    this.humidityStatus = this.statusArr.find((item) => {
      return item.code === "humidness" && typeof item.value === "number";
    });

    if (this.humidityStatus) {
      // Check if the humidity service already exists
      this.humiditySensor = this.homebridgeAccessory.getService(
        Service.HumiditySensor,
      );

      if (!this.humiditySensor) {
        // Add new humidity service
        this.humiditySensor = this.homebridgeAccessory.addService(
          Service.HumiditySensor,
          this.deviceConfig.name + " Humidity",
        );
      }

      // Update service characteristic
      this.humiditySensor.setCharacteristic(
        Characteristic.Name,
        this.deviceConfig.name + " Humidity",
      );
    }
  }

  addModeSwitches() {
    this.modeStatus = this.statusArr.find((item) => item.code === "mode");
    if (this.modeStatus) {
      const modes = ["cool", "arefaction", "fan"];
      const modeNames = {
        cool: "Cool",
        arefaction: "Dehumidifier",
        fan: "Fan",
      };
      this.modeServices = {};

      modes.forEach((mode) => {
        let modeService = this.homebridgeAccessory.getServiceById(
          Service.Switch,
          mode,
        );
        if (!modeService) {
          modeService = this.homebridgeAccessory.addService(
            Service.Switch,
            `${this.deviceConfig.name} ${modeNames[mode]}`,
            mode,
          );
        } else {
          modeService.displayName = modeNames[mode];
        }
        this.modeServices[mode] = modeService;

        modeService
          .getCharacteristic(Characteristic.On)
          .on("set", (value, callback) => {
            if (value) {
              this.setMode(mode);
            }
            callback();
          });
      });

      // Set the correct switch ON based on current mode status
      const currentMode = this.modeStatus.value;
      if (currentMode && this.modeServices[currentMode]) {
        this.modeServices[currentMode].updateCharacteristic(
          Characteristic.On,
          true,
        );
      }
    }
  }

  setMode(selectedMode) {
    const param = {
      commands: [{ code: "mode", value: selectedMode }],
    };
    this.platform.tuyaOpenApi
      .sendCommand(this.deviceId, param)
      .then(() => {
        for (const [mode, service] of Object.entries(this.modeServices)) {
          service.updateCharacteristic(
            Characteristic.On,
            mode === selectedMode,
          );
        }
      })
      .catch((error) => {
        this.log.error("[SET] Mode switch error: %s", error);
      });
  }

  addAccessoryInformation() {
    const accessoryInfo = this.homebridgeAccessory.getService(
      Service.AccessoryInformation,
    );

    if (accessoryInfo) {
      accessoryInfo
        .setCharacteristic(Characteristic.Manufacturer, "Morphy Richards")
        .setCharacteristic(Characteristic.Model, "Cooling Max");
    }
  }

  //init Or refresh AccessoryService
  refreshAccessoryServiceIfNeed(statusArr, isRefresh) {
    this.isRefresh = isRefresh;
    let currentMode = null;

    for (const statusMap of statusArr) {
      //Power on/off
      if (statusMap.code === "switch") {
        this.switchMap = statusMap;
        const hbSwitch = this.tuyaParamToHomeBridge(
          Characteristic.Active,
          this.switchMap.value,
        );
        this.normalAsync(Characteristic.Active, hbSwitch);
      }

      if (statusMap.code === "mode") {
        this.modeStatus = statusMap;
        currentMode = statusMap.value;
      }

      if (statusMap.code === "child_lock") {
        this.lockMap = statusMap;
        const hbLock = this.tuyaParamToHomeBridge(
          Characteristic.LockPhysicalControls,
          this.lockMap.value,
        );
        this.normalAsync(Characteristic.LockPhysicalControls, hbLock);
      }

      // Controls the speed and the API applies this to fan speed too
      if (statusMap.code === "cool_wind_speed") {
        this.speedMap = statusMap;
        let speed = 100;
        // Strong / High / Gentle
        switch (statusMap.value) {
          case "High":
            speed = 66;
            break;
          case "Gentle":
          case "Sleep":
            speed = 33;
            break;
          default:
            speed = 100;
            break;
        }

        this.normalAsync(Characteristic.RotationSpeed, parseFloat(speed));
      }

      // Applies to horizontal and vertical via API
      if (statusMap.code === "switch_vertical") {
        this.swingMap = statusMap;
        const hbSwing = this.tuyaParamToHomeBridge(
          Characteristic.SwingMode,
          this.swingMap.value,
        );
        this.normalAsync(Characteristic.SwingMode, hbSwing);
      }

      // Fan Light
      if (this.lightService && statusMap.code === "light") {
        this.switchLed = statusMap;
        const hbLight = this.tuyaParamToHomeBridge(
          Characteristic.On,
          this.switchLed.value,
        );
        this.normalAsync(Characteristic.On, hbLight, this.lightService);
      }

      // Humidity Status
      if (this.humiditySensor && statusMap.code === "humidness") {
        this.humidityStatus = statusMap;
        const hbHumidity = this.tuyaParamToHomeBridge(
          Characteristic.CurrentRelativeHumidity,
          parseFloat(this.humidityStatus.value),
        );
        this.normalAsync(
          Characteristic.CurrentRelativeHumidity,
          hbHumidity,
          this.humiditySensor,
        );
      }
    }

    // Handle mode as it comes back from the API with different keys
    if (!currentMode) {
      const modeEntry = statusArr.find((item) => Object.keys(item)[0] === "3");
      if (modeEntry) {
        currentMode = modeEntry["3"];
      }
    }

    if (currentMode) {
      Object.keys(this.modeServices).forEach((mode) => {
        this.modeServices[mode].updateCharacteristic(
          Characteristic.On,
          mode === currentMode,
        );
      });
    }
  }

  normalAsync(name, hbValue, service = null) {
    this.setCachedState(name, hbValue);
    if (this.isRefresh) {
      (service ? service : this.service)
        .getCharacteristic(name)
        .updateValue(hbValue);
    } else {
      this.getAccessoryCharacteristic(name, service);
    }
  }

  getAccessoryCharacteristic(name, service = null) {
    //set  Accessory service Characteristic
    (service ? service : this.service)
      .getCharacteristic(name)
      .on("get", (callback) => {
        if (this.hasValidCache()) {
          // If the cache is valid, get the cached state
          callback(null, this.getCachedState(name));
        } else {
          // If cache is invalid, handle the situation without calling callback again
          callback(new Error("No valid cache available"));
        }
      })
      .on("set", (value, callback) => {
        const param = this.getSendParam(name, value, service);
        this.platform.tuyaOpenApi
          .sendCommand(this.deviceId, param)
          .then(() => {
            this.setCachedState(name, value);
            callback();
          })
          .catch((error) => {
            this.log.error(
              "[SET][%s] Characteristic Error: %s",
              this.homebridgeAccessory.displayName,
              error,
            );
            this.invalidateCache();
            callback(error);
          });
      });
  }

  getSendParam(name, hbValue, service = "") {
    var code;
    var value;

    switch (name) {
      case Characteristic.Active:
        value = hbValue == 1 ? true : false;
        const isOn = value;
        code = this.switchMap.code;
        value = isOn;
        break;
      case Characteristic.LockPhysicalControls:
        value = hbValue == 1 ? true : false;
        const isLock = value;
        code = "child_lock";
        value = isLock;
        break;
      case Characteristic.RotationSpeed:
        let speed;
        let currentSpeedValue = Math.floor(hbValue);

        if (currentSpeedValue >= 66) {
          speed = "Strong";
        } else if (currentSpeedValue >= 33) {
          speed = "High";
        } else {
          speed = "Gentle";
        }
        code = this.speedMap.code;
        value = speed;
        break;
      case Characteristic.SwingMode:
        value = hbValue == 1 ? true : false;
        const isSwing = value;
        code = "switch_vertical";
        value = isSwing;
        break;
      case Characteristic.On:
        code = this.switchLed.code;
        value = hbValue == 1 ? true : false;
        break;
      case Characteristic.CurrentRelativeHumidity:
        code = this.humidityStatus.code;
        value = parseFloat(hbValue);
        break;
      case Characteristic.Brightness:
        value = Math.floor(
          ((this.bright_range.max - this.bright_range.min) * hbValue) / 100 +
            this.bright_range.min,
        ); //  value 0~100
        code = this.brightValue.code;
        break;
      default:
        break;
    }
    return {
      commands: [
        {
          code: code,
          value: value,
        },
      ],
    };
  }

  tuyaParamToHomeBridge(name, param) {
    switch (name) {
      case Characteristic.On:
      case Characteristic.Active:
      case Characteristic.LockPhysicalControls:
      case Characteristic.SwingMode:
        let status;
        if (param) {
          status = 1;
        } else {
          status = 0;
        }
        return status;
      case Characteristic.CurrentRelativeHumidity:
        return parseFloat(param);
    }
  }

  //update device status
  updateState(data) {
    this.refreshAccessoryServiceIfNeed(data.status, true);
  }
}

module.exports = DuctlessAirConditionerAccessory;
