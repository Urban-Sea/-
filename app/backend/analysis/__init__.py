# Analysis package
# 本格ロジック（demoから移植）

from .asset_class import AssetClass, JPBenchmark, get_config
from .market_structure import MarketStructure, SwingPoint as MSSwingPoint, GRANULARITY_MAP
from .choch_detector import CHoCHDetector, CHoCHType, CHoCHQuality, CHoCHSignal
from .bos_detector import BOSDetector, BOSType, BOSGrade, BOSSignal, BOSAnalysis
from .regime_detector import RegimeDetector, RegimeResult, detect_regime
from .order_block_detector import OrderBlockDetector, OrderBlock
from .ote_calculator import OTECalculator, OTEZone
from .premium_discount_detector import PremiumDiscountCalculator, PremiumDiscountZone
from .combined_entry_detector import CombinedEntryDetector, EntryMode, EntryAnalysis
from .exit_manager import evaluate_trade, TradeResult, HoldingStatus, TRAIL_MULT

__all__ = [
    # Asset Class
    "AssetClass",
    "JPBenchmark",
    "get_config",
    # MarketStructure (V11)
    "MarketStructure",
    "MSSwingPoint",
    "GRANULARITY_MAP",
    # CHoCH
    "CHoCHDetector",
    "CHoCHType",
    "CHoCHQuality",
    "CHoCHSignal",
    # BOS
    "BOSDetector",
    "BOSType",
    "BOSGrade",
    "BOSSignal",
    "BOSAnalysis",
    # Regime
    "RegimeDetector",
    "RegimeResult",
    "detect_regime",
    # Order Block (V11)
    "OrderBlockDetector",
    "OrderBlock",
    # OTE (V11)
    "OTECalculator",
    "OTEZone",
    # Premium/Discount (V12)
    "PremiumDiscountCalculator",
    "PremiumDiscountZone",
    # Entry
    "CombinedEntryDetector",
    "EntryMode",
    "EntryAnalysis",
    # Exit
    "evaluate_trade",
    "TradeResult",
    "HoldingStatus",
    "TRAIL_MULT",
]
