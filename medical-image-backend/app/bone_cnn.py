from __future__ import annotations

try:
    import torch
    from torch import nn
except Exception:  # pragma: no cover - training dependency
    torch = None
    nn = None


if nn is not None:

    class ConvBlock(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.block = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=2),
            )

        def forward(self, x):  # type: ignore[no-untyped-def]
            return self.block(x)


    class BonePathologyCNN(nn.Module):
        """Compact CNN for grayscale bone X-ray/CT/MRI screening.

        Input shape: `[batch, 1, H, W]`, normalized to `[0, 1]`.
        The adaptive pooling layer allows inference with 512x512 images from
        the existing backend preprocessing pipeline.
        """

        def __init__(self, num_classes: int, dropout: float = 0.35) -> None:
            super().__init__()
            self.features = nn.Sequential(
                ConvBlock(1, 32),
                ConvBlock(32, 64),
                ConvBlock(64, 128),
                ConvBlock(128, 256),
                nn.AdaptiveAvgPool2d((1, 1)),
            )
            self.classifier = nn.Sequential(
                nn.Flatten(),
                nn.Dropout(dropout),
                nn.Linear(256, 128),
                nn.ReLU(inplace=True),
                nn.Dropout(dropout),
                nn.Linear(128, num_classes),
            )

        def forward(self, x):  # type: ignore[no-untyped-def]
            return self.classifier(self.features(x))


def build_bone_cnn(num_classes: int):
    if nn is None:
        raise RuntimeError("PyTorch is required to build the bone CNN")
    return BonePathologyCNN(num_classes=num_classes)

