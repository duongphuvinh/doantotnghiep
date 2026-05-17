from __future__ import annotations

try:
    import torch
    from torch import nn
except Exception:  # pragma: no cover
    torch = None
    nn = None


if nn is not None:

    class BoneLabFusionMLP(nn.Module):
        """Trainable fusion head for image, clinical, and lab feature vectors."""

        def __init__(self, input_dim: int, num_classes: int, hidden_dim: int = 128) -> None:
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(input_dim, hidden_dim),
                nn.ReLU(inplace=True),
                nn.Dropout(0.25),
                nn.Linear(hidden_dim, hidden_dim // 2),
                nn.ReLU(inplace=True),
                nn.Dropout(0.2),
                nn.Linear(hidden_dim // 2, num_classes),
            )

        def forward(self, x):  # type: ignore[no-untyped-def]
            return self.net(x)


def build_fusion_mlp(input_dim: int, num_classes: int):
    if nn is None:
        raise RuntimeError("PyTorch is required to build fusion MLP")
    return BoneLabFusionMLP(input_dim=input_dim, num_classes=num_classes)

