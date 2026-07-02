from abc import ABC, abstractmethod
from typing import Dict, Any, List

class MetricSource(ABC):
    @abstractmethod
    def get_node_metrics(self) -> Dict[str, Any]:
        """Gets CPU, Memory, Disk, and Network stats of the host machine."""
        pass

    @abstractmethod
    def get_container_metrics(self) -> List[Dict[str, Any]]:
        """Gets the list of containers running on the host and their stats."""
        pass
